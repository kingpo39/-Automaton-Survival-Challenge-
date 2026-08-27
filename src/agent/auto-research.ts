/**
 * src/agent/auto-research.ts
 *
 * AUTO-RESEARCH PIPELINE
 *
 * Problem: Small 1.8B models can't reliably call tools like web_search.
 * They generate reasoning text instead of actual tool calls.
 *
 * Solution: Detect when a chat message needs web research, automatically
 * fetch results, and inject them as context so the LLM only needs to
 * summarize — no tool calling required.
 *
 * Flow:
 *   1. User sends chat message
 *   2. Pipeline detects research-worthy patterns (search, what is, latest, etc.)
 *   3. Automatically calls web_search + fetch_webpage
 *   4. Injects results into the prompt as "[AUTO-RESEARCH RESULTS]"
 *   5. LLM summarizes the pre-fetched data (no tool calls needed)
 */

import { webSearch, fetchWebpage } from '../mcp/web-research.js'
import { createLogger } from '../observability/logger.js'

const log = createLogger('agent:auto-research')

// ── Detection patterns ──────────────────────────────────────────────────────

interface ResearchPattern {
  patterns: RegExp[]
  category: string
  searchModifier?: (query: string) => string
}

const RESEARCH_PATTERNS: ResearchPattern[] = [
  {
    patterns: [
      /search\s+(for|about|the)\s+/i,
      /look\s+(up|into)\s+/i,
      /google\s+/i,
      /find\s+(out|information|info)\s+(about|on|for)\s+/i,
      /what\s+do\s+people\s+say\s+about/i,
    ],
    category: 'search',
  },
  {
    patterns: [
      /what\s+(is|are|was|were)\s+the\s+(latest|current|newest|recent)\s+/i,
      /what('s|\s+is|\s+are)\s+(happening|going\s+on|new)\s+(with|in|about)/i,
      /latest\s+(news|updates|changes|developments)\s+(about|on|in|for)/i,
      /recent\s+(news|updates|changes)\s+(about|on|for)/i,
      /what('s|\s+is)\s+new\s+(with|in|about)/i,
    ],
    category: 'news',
  },
  {
    patterns: [
      /how\s+(do|does|to|can)\s+/i,
      /tutorial\s+(for|on|about)/i,
      /guide\s+(for|on|about)/i,
      /example\s+(of|for)\s+/i,
    ],
    category: 'howto',
    searchModifier: (q: string) => `${q} tutorial guide`,
  },
  {
    patterns: [
      /compare\s+.+\s+(with|vs|versus|and)\s+/i,
      /difference\s+between\s+/i,
      /which\s+(is|one)\s+better/i,
      /pros?\s+and\s+cons?\s+(of|for)/i,
    ],
    category: 'comparison',
    searchModifier: (q: string) => `${q} comparison review`,
  },
  {
    patterns: [
      /who\s+(is|are|was|were|invented|created|founded|made)\s+/i,
      /when\s+(did|was|is|are)\s+/i,
      /where\s+(is|are|was|were|can)\s+/i,
    ],
    category: 'factual',
  },
  {
    patterns: [
      /price\s+(of|for)\s+/i,
      /how\s+much\s+(does|is|cost)/i,
      /market\s+(cap|price|data)/i,
      /stock\s+(price|value)/i,
      /cryptocurrency|crypto|token|coin\s+price/i,
      /usdc|usdt|eth|btc\s+(price|balance|value)/i,
    ],
    category: 'market',
    searchModifier: (q: string) => `${q} current price`,
  },
  {
    patterns: [
      /best\s+(tools?|software|apps?|services?|frameworks?|libraries)\s+(for|to|that)/i,
      /recommend\s+(a|some|the|me)\s+/i,
      /alternatives?\s+(to|for|of)\s+/i,
    ],
    category: 'recommendation',
    searchModifier: (q: string) => `${q} 2026 best`,
  },
]

// ── Detection ───────────────────────────────────────────────────────────────

export interface ResearchPlan {
  needsResearch: boolean
  queries: string[]
  category: string
  originalMessage: string
}

/**
 * Analyze a user message and determine if it needs web research.
 */
export function detectResearchNeed(message: string): ResearchPlan {
  const plan: ResearchPlan = {
    needsResearch: false,
    queries: [],
    category: 'none',
    originalMessage: message,
  }

  for (const pattern of RESEARCH_PATTERNS) {
    for (const regex of pattern.patterns) {
      if (regex.test(message)) {
        plan.needsResearch = true
        plan.category = pattern.category

        // Build search query from the message
        let query = message
          .replace(/\b(please|can you|could you|i want to|i need to|hey|hi|hello)\b/gi, '')
          .replace(/\b(search|look up|google|find out about|tell me about)\b/gi, '')
          .trim()

        if (pattern.searchModifier) {
          query = pattern.searchModifier(query)
        }

        // Limit query length for search engines
        query = query.slice(0, 200)

        plan.queries = [query]
        log.info('Research detected', { category: pattern.category, query })
        return plan
      }
    }
  }

  return plan
}

// ── Research execution ──────────────────────────────────────────────────────

export interface ResearchResult {
  query: string
  category: string
  results: Array<{ title: string; url: string; snippet: string }>
  pageContents: Array<{ title: string; text: string; url: string }>
  totalTimeMs: number
}

/**
 * Execute web research for a detected query.
 * Returns structured results that can be injected into the prompt.
 */
export async function executeResearch(plan: ResearchPlan): Promise<ResearchResult> {
  const start = Date.now()
  log.info('Executing auto-research', { queries: plan.queries, category: plan.category })

  // Notify dashboard: research starting
  try {
    await fetch('http://localhost:9876/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'research_start', content: plan.category }),
      signal: AbortSignal.timeout(2000),
    })
  } catch {}

  const result: ResearchResult = {
    query: plan.queries[0] || '',
    category: plan.category,
    results: [],
    pageContents: [],
    totalTimeMs: 0,
  }

  try {
    // Step 1: Web search
    const searchResults = await webSearch(plan.queries[0], 5)
    result.results = searchResults

    // Step 2: Fetch top 2 pages for content
    const topUrls = searchResults.slice(0, 2).map(r => r.url)
    for (const url of topUrls) {
      try {
        const page = await fetchWebpage(url)
        result.pageContents.push({
          title: page.title,
          text: page.text.slice(0, 2000), // Limit to 2K chars per page
          url,
        })
      } catch {
        // Skip failed pages
      }
    }
  } catch (err) {
    log.warn('Auto-research failed', { error: String(err) })
  }

  result.totalTimeMs = Date.now() - start
  log.info('Auto-research complete', {
    resultsCount: result.results.length,
    pagesFetched: result.pageContents.length,
    timeMs: result.totalTimeMs,
  })

  // Notify dashboard: research finished
  try {
    await fetch('http://localhost:9876/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'research_done', content: result.results.length }),
      signal: AbortSignal.timeout(2000),
    })
  } catch {}

  return result
}

/**
 * Format research results as a context block for the LLM prompt.
 */
export function formatResearchContext(result: ResearchResult): string {
  const lines: string[] = [
    `[AUTO-RESEARCH RESULTS — ${result.category.toUpperCase()}]`,
    `Query: "${result.query}"`,
    '',
  ]

  // Search results summary
  if (result.results.length > 0) {
    lines.push('Search Results:')
    for (const r of result.results.slice(0, 5)) {
      lines.push(`  - ${r.title}`)
      lines.push(`    URL: ${r.url}`)
      if (r.snippet) lines.push(`    ${r.snippet}`)
      lines.push('')
    }
  }

  // Page content excerpts
  if (result.pageContents.length > 0) {
    lines.push('Page Content Excerpts:')
    for (const page of result.pageContents) {
      lines.push(`--- ${page.title} (${page.url}) ---`)
      lines.push(page.text.slice(0, 1500))
      lines.push('---')
      lines.push('')
    }
  }

  lines.push('[END AUTO-RESEARCH]')
  lines.push('')
  lines.push('Using the above research results, provide a clear and helpful answer to the user\'s question.')

  return lines.join('\n')
}

/**
 * Full pipeline: detect → research → format.
 * Returns null if no research is needed.
 */
export async function autoResearchPipeline(
  userMessage: string,
): Promise<{ enrichedMessage: string; wasResearched: boolean; category: string }> {
  const plan = detectResearchNeed(userMessage)

  if (!plan.needsResearch) {
    return {
      enrichedMessage: userMessage,
      wasResearched: false,
      category: 'none',
    }
  }

  const researchResult = await executeResearch(plan)
  const researchContext = formatResearchContext(researchResult)

  // Inject research context into the message
  const enrichedMessage = `${userMessage}\n\n${researchContext}`

  return {
    enrichedMessage,
    wasResearched: true,
    category: researchResult.category,
  }
}
