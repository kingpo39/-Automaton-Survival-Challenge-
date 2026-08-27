/**
 * src/agent/tool-extractor.ts
 *
 * Regex-based tool-call extractor that parses the model's text output
 * for implicit tool calls and executes them automatically.
 *
 * WHY THIS EXISTS:
 *   Small models (1.5B-2B) can't produce structured tool calls via the API.
 *   Instead they output text like:
 *     "I'll search for that... web_search(query='latest news')"
 *     "Let me check the balance. check_balance()"
 *   This module detects those patterns, extracts the tool calls,
 *   executes them, and appends the results to the response.
 *
 * HOW IT WORKS:
 *   1. Scan the model's text output for tool-call patterns
 *   2. Parse tool name and arguments from the matched text
 *   3. Execute each tool via the standard tool executor
 *   4. Append results as structured blocks the model can reference
 *
 * SUPPORTED FORMATS:
 *   - Explicit: web_search(query="...")  check_balance()  recall_facts(category="...")
 *   - Markdown code blocks: ```tool_name(arg="val")```
 *   - Natural language hints: "I searched for X" → may need to actually search
 *   - JSON-style: {"tool": "web_search", "args": {"query": "..."}}
 *   - Numbered arguments: web_search("query text")
 */

import { createLogger } from '../observability/logger.js'
import type { ToolContext, ToolResult } from '../types.js'

const log = createLogger('agent:tool-extractor')

// ── Tool call patterns ─────────────────────────────────────────────────────

export interface ExtractedToolCall {
  toolName: string
  args: Record<string, unknown>
  rawMatch: string
  confidence: number  // 0-1, how sure we are this is a real tool call
}

// Known tool names that the extractor looks for
const KNOWN_TOOLS = new Set([
  'web_search', 'fetch_webpage', 'scrape_webpage', 'research_topic',
  'check_balance', 'check_usdc_balance', 'system_synopsis',
  'recall_facts', 'remember_fact', 'review_memory',
  'lookup_docs', 'github_search_repos', 'github_read_file',
  'github_search_code', 'github_get_commits',
  'git_status', 'git_diff', 'git_log', 'git_commit',
  'send_message', 'sleep',
])

// ── Regex patterns for extraction ───────────────────────────────────────────

/**
 * Pattern 1: Explicit function call — tool_name(args)
 * Matches: web_search(query="hello world") or check_balance()
 */
const FUNC_CALL_PATTERN = /\b(\w+)\s*\(([^)]*)\)\s*/g

/**
 * Pattern 2: Inside markdown code blocks — ```tool_name(args)```
 */
const CODE_BLOCK_PATTERN = /```\w*\s*(\w+)\s*\(([^)]*)\)\s*```/g

/**
 * Pattern 3: JSON-style tool call — {"tool": "name", "args": {...}}
 */
const JSON_TOOL_PATTERN = /\{[\s]*"tool"\s*:\s*"(\w+)"\s*,\s*"(?:args|parameters|params)"\s*:\s*\{([^}]*)\}\s*\}/g

/**
 * Pattern 4: XML-style — <tool name="web_search" query="hello"/>
 */
const XML_TOOL_PATTERN = /<tool\s+name="(\w+)"([^>]+)\/>/g

/**
 * Pattern 5: Bracket notation — [web_search: query="hello"]
 */
const BRACKET_PATTERN = /\[(\w+)\s*:\s*([^\]]+)\]/g

// ── Argument parsers ────────────────────────────────────────────────────────

/**
 * Parse arguments from a function call string like: query="hello", limit=5, key='value'
 */
function parseArgsString(argsStr: string): Record<string, unknown> {
  if (!argsStr || !argsStr.trim()) return {}

  const args: Record<string, unknown> = {}
  const trimmed = argsStr.trim()

  // Try JSON parse first
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed)
    } catch { /* fall through */ }
  }

  // Try positional single argument: tool("just a string")
  const singleStringMatch = trimmed.match(/^["'](.+)["']$/)
  if (singleStringMatch) {
    // Map to first param name based on tool
    return { query: singleStringMatch[1] }
  }

  // Parse key=value pairs
  const argPattern = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\d+(?:\.\d+)?)|(\w+))/g
  let match: RegExpExecArray | null

  while ((match = argPattern.exec(trimmed)) !== null) {
    const key = match[1]
    const value = match[2] ?? match[3] ?? match[4] ?? match[5]

    // Convert numbers
    if (match[4]) {
      args[key] = parseFloat(match[4])
    } else if (value === 'true') {
      args[key] = true
    } else if (value === 'false') {
      args[key] = false
    } else if (value === 'null') {
      args[key] = null
    } else {
      args[key] = value
    }
  }

  return args
}

/**
 * Parse XML attributes: key="value" key2='value2'
 */
function parseXmlAttrs(attrStr: string): Record<string, unknown> {
  const attrs: Record<string, unknown> = {}
  const pattern = /(\w+)\s*=\s*"([^"]*)"/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(attrStr)) !== null) {
    attrs[match[1]] = match[2]
  }
  return attrs
}

/**
 * Parse bracket notation arguments: key="val", key2=5
 */
function parseBracketArgs(argsStr: string): Record<string, unknown> {
  const args: Record<string, unknown> = {}
  const parts = argsStr.split(',')
  for (const part of parts) {
    const kv = part.split('=')
    if (kv.length === 2) {
      const key = kv[0].trim()
      let value: unknown = kv[1].trim()
      // Strip quotes
      if ((value as string).startsWith('"') || (value as string).startsWith("'")) {
        value = (value as string).slice(1, -1)
      }
      args[key] = value
    }
  }
  return args
}

// ── Confidence scoring ──────────────────────────────────────────────────────

/**
 * Score how confident we are that this extracted call is intentional.
 * High confidence = the model is explicitly calling a tool.
 * Low confidence = might be coincidental text.
 */
function scoreConfidence(extracted: ExtractedToolCall, surroundingText: string): number {
  let score = 0

  // Known tool name? +0.4
  if (KNOWN_TOOLS.has(extracted.toolName)) {
    score += 0.4
  }

  // Has properly parsed args? +0.2
  if (Object.keys(extracted.args).length > 0) {
    score += 0.2
  }

  // Tool call is inside code block? +0.2
  if (surroundingText.includes('```') && surroundingText.includes(extracted.rawMatch)) {
    score += 0.2
  }

  // Preceded by action verbs? +0.2
  const idx = surroundingText.indexOf(extracted.rawMatch)
  if (idx > 0) {
    const before = surroundingText.slice(Math.max(0, idx - 50), idx)
    if (/\b(search|look|find|check|fetch|read|recall|execute|run|use|call|invoke)\b/i.test(before)) {
      score += 0.2
    }
  }

  return Math.min(score, 1)
}

// ── Main extraction ─────────────────────────────────────────────────────────

/**
 * Extract all tool calls from the model's text output.
 */
export function extractToolCalls(text: string): ExtractedToolCall[] {
  if (!text || text.length < 5) return []

  const extracted: ExtractedToolCall[] = []
  const seen = new Set<string>()

  // Pattern 1: Code blocks (highest priority — model explicitly formatted)
  for (const match of text.matchAll(CODE_BLOCK_PATTERN)) {
    const toolName = match[1]
    const args = parseArgsString(match[2])
    const key = `${toolName}:${JSON.stringify(args)}`
    if (!seen.has(key)) {
      seen.add(key)
      extracted.push({ toolName, args, rawMatch: match[0], confidence: 0.9 })
    }
  }

  // Pattern 3: JSON-style
  for (const match of text.matchAll(JSON_TOOL_PATTERN)) {
    const toolName = match[1]
    const args = parseArgsString(match[2])
    const key = `${toolName}:${JSON.stringify(args)}`
    if (!seen.has(key)) {
      seen.add(key)
      extracted.push({ toolName, args, rawMatch: match[0], confidence: 0.85 })
    }
  }

  // Pattern 4: XML-style
  for (const match of text.matchAll(XML_TOOL_PATTERN)) {
    const toolName = match[1]
    const args = parseXmlAttrs(match[2])
    const key = `${toolName}:${JSON.stringify(args)}`
    if (!seen.has(key)) {
      seen.add(key)
      extracted.push({ toolName, args, rawMatch: match[0], confidence: 0.8 })
    }
  }

  // Pattern 5: Bracket notation
  for (const match of text.matchAll(BRACKET_PATTERN)) {
    const toolName = match[1]
    if (!KNOWN_TOOLS.has(toolName)) continue  // Skip unknown tools in bracket format
    const args = parseBracketArgs(match[2])
    const key = `${toolName}:${JSON.stringify(args)}`
    if (!seen.has(key)) {
      seen.add(key)
      extracted.push({ toolName, args, rawMatch: match[0], confidence: 0.7 })
    }
  }

  // Pattern 1: Generic function calls (lowest priority — may have false positives)
  for (const match of text.matchAll(FUNC_CALL_PATTERN)) {
    const toolName = match[1]
    // Skip common non-tool patterns
    if (isCommonNonTool(toolName)) continue

    const args = parseArgsString(match[2])
    const key = `${toolName}:${JSON.stringify(args)}`
    if (!seen.has(key)) {
      seen.add(key)
      const conf = scoreConfidence(
        { toolName, args, rawMatch: match[0], confidence: 0 },
        text,
      )
      extracted.push({ toolName, args, rawMatch: match[0], confidence: conf })
    }
  }

  // Filter: only keep known tools or high-confidence unknowns
  const filtered = extracted.filter(e => {
    if (KNOWN_TOOLS.has(e.toolName)) return true
    if (e.confidence >= 0.6) {
      log.warn('Extracted unknown tool call, including due to high confidence', {
        tool: e.toolName,
        confidence: e.confidence,
      })
      return true
    }
    return false
  })

  if (filtered.length > 0) {
    log.info('Extracted tool calls from text', {
      count: filtered.length,
      tools: filtered.map(e => e.toolName),
    })
  }

  return filtered
}

/**
 * Skip common function-like patterns that aren't tool calls.
 */
function isCommonNonTool(name: string): boolean {
  const skip = new Set([
    'console', 'Math', 'JSON', 'Promise', 'Array', 'Object', 'String', 'Number',
    'Date', 'RegExp', 'Error', 'Map', 'Set', 'parseInt', 'parseFloat',
    'require', 'import', 'export', 'function', 'return', 'if', 'else',
    'for', 'while', 'switch', 'case', 'break', 'continue', 'throw',
    'try', 'catch', 'finally', 'new', 'typeof', 'instanceof', 'delete',
    'void', 'in', 'of', 'this', 'super', 'class', 'extends', 'static',
    'get', 'set', 'async', 'await', 'yield',
    'log', 'error', 'warn', 'info', 'debug',
    'print', 'puts', 'echo', 'printf', 'fmt',
    'let', 'var', 'const', 'def', 'class', 'lambda',
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'FROM', 'WHERE',
    'true', 'false', 'null', 'undefined', 'NaN', 'Infinity',
  ])
  return skip.has(name) || name.length <= 1
}

// ── Execution ───────────────────────────────────────────────────────────────

export interface ExtractionResult {
  extractedCalls: ExtractedToolCall[]
  executedCalls: Array<{
    call: ExtractedToolCall
    result: ToolResult
    durationMs: number
  }>
  summary: string
}

/**
 * Extract tool calls from text and execute them.
 * Returns results that can be injected into the response context.
 */
export async function extractAndExecute(
  text: string,
  toolContext: ToolContext,
  maxExecutions = 3,  // Safety: don't run too many tools from one response
): Promise<ExtractionResult> {
  const calls = extractToolCalls(text)

  // Sort by confidence, take top N
  const toExecute = calls
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxExecutions)

  const executedCalls: ExtractionResult['executedCalls'] = []

  for (const call of toExecute) {
    const start = Date.now()
    try {
      // Dynamically import executeTool to avoid circular dependency
      const { executeTool } = await import('./tools.js')
      const result = await executeTool(call.toolName, call.args, toolContext)
      const durationMs = Date.now() - start

      executedCalls.push({ call, result, durationMs })

      log.info('Extracted tool executed', {
        tool: call.toolName,
        success: result.success,
        durationMs,
        confidence: call.confidence,
      })
    } catch (err) {
      log.error('Extracted tool execution failed', {
        tool: call.toolName,
        error: String(err),
      })
    }
  }

  // Build summary for context injection
  const summary = executedCalls.length > 0
    ? executedCalls.map(ec => {
        const output = ec.result.output?.slice(0, 500) ?? 'no output'
        return `[Tool Result: ${ec.call.toolName}]\n${output}`
      }).join('\n\n')
    : ''

  return { extractedCalls: calls, executedCalls, summary }
}
