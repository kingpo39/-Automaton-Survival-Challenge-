/**
 * src/agent/tool-forcer.ts
 *
 * Detects when the model should have called a tool but didn't,
 * then retries with a more explicit prompt.
 *
 * WHY THIS EXISTS:
 *   Small models (1.5B-2B) often fail to call tools even when asked.
 *   They generate reasoning text instead of actual tool calls.
 *   This module detects that pattern and retries with explicit instructions.
 *
 * HOW IT WORKS:
 *   1. After inference, analyze the user's message for tool-requiring patterns
 *   2. Check if the model's response contains any tool calls
 *   3. If not, inject a "MUST USE TOOL" retry prompt
 *   4. Re-run inference with the explicit prompt
 *
 * DETECTION PATTERNS:
 *   - "search for..." → should use web_search
 *   - "what is X balance..." → should use check_balance
 *   - "read the file..." → should use read_file
 *   - "remember that..." → should use remember_fact
 *   - "look up docs for..." → should use lookup_docs
 */

import { createLogger } from '../observability/logger.js'

const log = createLogger('agent:tool-forcer')

// ── Tool requirement patterns ────────────────────────────────────────────────

interface ToolPattern {
  patterns: RegExp[]
  requiredTool: string
  description: string
}

const TOOL_PATTERNS: ToolPattern[] = [
  {
    patterns: [
      /search\s+(for|about|the)\s+/i,
      /look\s+up\s+/i,
      /google\s+/i,
      /find\s+(out|information|info)\s+/i,
      /what('s| is| are)\s+(the\s+)?(latest|current|newest|recent)/i,
      /research\s+/i,
      /what\s+do\s+people\s+say\s+about/i,
      /what\s+is\s+.{10,}/i,  // long questions likely need research
    ],
    requiredTool: 'web_search',
    description: 'search/research request',
  },
  {
    patterns: [
      /my\s+balance/i,
      /check\s+(my\s+)?(balance|usdc|credits|funds)/i,
      /how\s+much\s+(do\s+I|money|usdc|credit)/i,
      /wallet\s+balance/i,
    ],
    requiredTool: 'check_balance',
    description: 'balance check request',
  },
  {
    patterns: [
      /read\s+(the\s+)?(file|code|source|document)/i,
      /show\s+me\s+(the\s+)?(file|code|contents)/i,
      /open\s+(the\s+)?file/i,
      /what('s| is)\s+in\s+.{0,20}\.(ts|js|py|json|md)/i,
    ],
    requiredTool: 'read_file',
    description: 'file read request',
  },
  {
    patterns: [
      /remember\s+(that|this|these)/i,
      /note\s+(that|this|these)/i,
      /store\s+(this|that|the\s+fact)/i,
      /save\s+(this|that)\s+(as|to)\s+(memory|knowledge)/i,
      /don'?t\s+forget/i,
    ],
    requiredTool: 'remember_fact',
    description: 'memory storage request',
  },
  {
    patterns: [
      /docs?\s+(for|about|on)\s+/i,
      /documentation\s+(for|about|on)/i,
      /how\s+does\s+\w+\s+(work|handle|implement)/i,
      /api\s+(reference|docs|documentation)/i,
      /what('s| is)\s+the\s+syntax\s+for/i,
    ],
    requiredTool: 'lookup_docs',
    description: 'documentation lookup request',
  },
  {
    patterns: [
      /git\s+(status|log|diff|commit)/i,
      /commit\s+(message|changes)/i,
      /what('s| is)\s+changed/i,
      /show\s+(me\s+)?(the\s+)?diff/i,
    ],
    requiredTool: 'git_status',
    description: 'git status request',
  },
  {
    patterns: [
      /web\s*scrape|scrape\s+(the\s+)?page/i,
      /render\s+(the\s+)?page/i,
      /sp[a]?\.?\s+page/i,
      /javascript[\s-]+rendered/i,
    ],
    requiredTool: 'scrape_webpage',
    description: 'web scraping request',
  },
  {
    patterns: [
      /github\s+(repo|search|find)/i,
      /search\s+(github|repos)/i,
      /find\s+(a\s+)?(repo|repository)/i,
    ],
    requiredTool: 'github_search_repos',
    description: 'GitHub search request',
  },
]

// ── Tool call detection ──────────────────────────────────────────────────────

/**
 * Check if the model's response contains any tool calls.
 * Tool calls appear as: tool_name({...}) or tool_name(...)
 */
function responseContainsToolCall(response: string): boolean {
  if (!response) return false

  // Check for explicit tool call patterns
  const toolCallPatterns = [
    /\w+\s*\(\s*\{[^}]*\}\s*\)/,    // tool({...})
    /\w+\s*\(\s*"[^"]*"\s*\)/,      // tool("arg")
    /\w+\s*\(\s*'[^']*'\s*\)/,      // tool('arg')
    /<tool_call>/i,                    // XML-style tool calls
    /function_call:/i,                 // JSON-style tool calls
  ]

  for (const pattern of toolCallPatterns) {
    if (pattern.test(response)) return true
  }

  return false
}

/**
 * Detect if a user message requires a specific tool.
 */
function detectRequiredTools(userMessage: string): ToolPattern[] {
  const required: ToolPattern[] = []

  for (const toolPattern of TOOL_PATTERNS) {
    for (const pattern of toolPattern.patterns) {
      if (pattern.test(userMessage)) {
        required.push(toolPattern)
        break // only match once per tool
      }
    }
  }

  return required
}

/**
 * Build a retry prompt that explicitly forces tool use.
 */
function buildRetryPrompt(
  originalMessage: string,
  requiredTools: ToolPattern[],
  originalResponse: string,
): string {
  const toolNames = requiredTools.map(t => t.requiredTool)
  const reasons = requiredTools.map(t => t.description)

  return [
    `CRITICAL: You were asked to ${reasons.join(' and ')} but you did NOT use the required tools.`,
    `You MUST call the ${toolNames.join(', ')} tool(s) NOW. Do NOT reply with just text.`,
    ``,
    `Your previous response was just text without any tool calls:`,
    `"${originalResponse.slice(0, 200)}"`,
    ``,
    `This is WRONG. You MUST use tools. Here is how:`,
    ...requiredTools.map(t => `- Call ${t.requiredTool} with appropriate parameters`),
    ``,
    `Original user message: "${originalMessage}"`,
    ``,
    `REMINDER: Reply with ONLY a tool call, not text.`,
  ].join('\n')
}

// ── Main export ──────────────────────────────────────────────────────────────

export interface ForcingResult {
  shouldRetry: boolean
  retryPrompt?: string
  requiredTools: string[]
  reason?: string
}

/**
 * Analyze if the model should have used a tool but didn't.
 * Returns a retry prompt if forcing is needed.
 */
export function analyzeAndForce(
  userMessage: string,
  modelResponse: string,
  turnNumber: number,
): ForcingResult {
  // Don't force on first few turns — model might be greeting
  if (turnNumber < 2) {
    return { shouldRetry: false, requiredTools: [] }
  }

  // Check if response already contains tool calls
  if (responseContainsToolCall(modelResponse)) {
    return { shouldRetry: false, requiredTools: [] }
  }

  // Detect if user message requires tools
  const requiredTools = detectRequiredTools(userMessage)
  if (requiredTools.length === 0) {
    return { shouldRetry: false, requiredTools: [] }
  }

  // Check if the response is too long (model is just reasoning, not acting)
  const isLongResponse = modelResponse.length > 300
  const isVagueResponse = /\b(I think|let me|maybe|probably|might|could)\b/i.test(modelResponse)
    && !/\b(call|use|execute|run)\b/i.test(modelResponse)

  if (isLongResponse || isVagueResponse) {
    log.info('Tool forcing triggered', {
      tools: requiredTools.map(t => t.requiredTool),
      responseLength: modelResponse.length,
      isVague: isVagueResponse,
    })

    const retryPrompt = buildRetryPrompt(
      userMessage,
      requiredTools,
      modelResponse,
    )

    return {
      shouldRetry: true,
      retryPrompt,
      requiredTools: requiredTools.map(t => t.requiredTool),
      reason: `User asked for ${requiredTools.map(t => t.description).join(', ')} but model replied with text only`,
    }
  }

  return { shouldRetry: false, requiredTools: requiredTools.map(t => t.requiredTool) }
}
