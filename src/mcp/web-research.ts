/**
 * src/mcp/web-research.ts
 *
 * Lightweight web research tool — replaces Playwright MCP.
 * Uses native fetch + cheerio for HTML parsing.
 * No Chromium overhead (~500MB saved on 8GB machine).
 *
 * Capabilities:
 *   - Fetch any URL and extract readable text
 *   - Search the web via DuckDuckGo HTML (no API key needed)
 *   - Extract structured data from HTML (tables, lists, links)
 */

import * as cheerio from 'cheerio'
import { createLogger } from '../observability/logger.js'

const log = createLogger('mcp:web-research')

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
const FETCH_TIMEOUT = 15_000

export interface WebResearchResult {
  url: string
  title: string
  text: string
  links: Array<{ text: string; href: string }>
  tables: Array<string[]>
  jsRendered: boolean
  fetchedAt: number
}

/**
 * Fetch a URL and extract readable content.
 */
export async function fetchWebpage(url: string): Promise<WebResearchResult> {
  log.info('Fetching URL', { url })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT)

  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
      redirect: 'follow',
    })

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`)
    }

    const html = await resp.text()
    const $ = cheerio.load(html)

    // Remove scripts, styles, nav, footer
    $('script, style, nav, footer, header, aside, noscript, iframe').remove()

    // Extract title
    const title = $('title').text().trim() || $('h1').first().text().trim() || ''

    // Extract main text content
    const text = $('body')
      .text()
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 10_000)  // cap at 10K chars

    // Extract links
    const links: Array<{ text: string; href: string }> = []
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || ''
      const text = $(el).text().trim()
      if (text && href && !href.startsWith('#') && !href.startsWith('javascript:')) {
        links.push({ text: text.slice(0, 100), href })
      }
    })

    // Extract tables
    const tables: string[][][] = []
    $('table').each((_, table) => {
      const rows: string[][] = []
      $(table).find('tr').each((_, row) => {
        const cells: string[] = []
        $(row).find('td, th').each((_, cell) => {
          cells.push($(cell).text().trim())
        })
        if (cells.length > 0) rows.push(cells)
      })
      if (rows.length > 0) tables.push(rows)
    })

    return {
      url,
      title,
      text,
      links: links.slice(0, 50),
      tables: tables[0] || [],  // first table
      jsRendered: false,
      fetchedAt: Date.now(),
    }
  } finally {
    clearTimeout(timer)
  }
}

// ── Search result cache (LRU, 1-hour TTL) ─────────────────────────────────

interface CacheEntry {
  results: Array<{ title: string; url: string; snippet: string }>
  fetchedAt: number
}

const searchCache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 60 * 60 * 1000  // 1 hour
const CACHE_MAX_SIZE = 100             // max entries

function getCacheKey(query: string): string {
  return query.toLowerCase().trim().replace(/\s+/g, ' ')
}

function getCached(query: string): Array<{ title: string; url: string; snippet: string }> | null {
  const key = getCacheKey(query)
  const entry = searchCache.get(key)
  if (entry && (Date.now() - entry.fetchedAt) < CACHE_TTL_MS) {
    log.info('Cache hit', { query, age: Date.now() - entry.fetchedAt })
    return entry.results
  }
  if (entry) searchCache.delete(key)  // expired
  return null
}

function setCache(query: string, results: Array<{ title: string; url: string; snippet: string }>): void {
  const key = getCacheKey(query)
  // Evict oldest if at capacity
  if (searchCache.size >= CACHE_MAX_SIZE) {
    const oldest = searchCache.keys().next().value
    if (oldest) searchCache.delete(oldest)
  }
  searchCache.set(key, { results, fetchedAt: Date.now() })
}

// ── Fallback: Wikipedia search API ──────────────────────────────────────────

async function wikipediaSearch(query: string, maxResults: number): Promise<Array<{ title: string; url: string; snippet: string }>> {
  // Use Wikipedia search API (not just page summary)
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${maxResults}&format=json&origin=*`
  
  try {
    const resp = await fetch(searchUrl, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(8000),
    })
    if (!resp.ok) return []
    
    const data = await resp.json() as any
    const results = (data.query?.search || []).map((r: any) => ({
      title: r.title || '',
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title || '')}`,
      snippet: (r.snippet || '').replace(/<[^>]*>/g, '').slice(0, 300),
    }))
    
    if (results.length > 0) {
      log.info('Wikipedia search succeeded', { results: results.length })
      return results
    }
  } catch {}
  return []
}

// ── Fallback: DuckDuckGo instant answers ────────────────────────────────────

async function duckduckgoInstant(query: string): Promise<Array<{ title: string; url: string; snippet: string }>> {
  try {
    const resp = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`,
      { signal: AbortSignal.timeout(5000) },
    )
    if (!resp.ok) return []
    
    const data = await resp.json() as any
    const results: Array<{ title: string; url: string; snippet: string }> = []
    
    if (data.AbstractText) {
      results.push({
        title: data.Heading || query,
        url: data.AbstractURL || '',
        snippet: data.AbstractText.slice(0, 300),
      })
    }
    // Also add related topics
    for (const topic of (data.RelatedTopics || []).slice(0, 3)) {
      if (topic.Text && topic.FirstURL) {
        results.push({
          title: topic.Text.slice(0, 80),
          url: topic.FirstURL,
          snippet: (topic.Text || '').slice(0, 300),
        })
      }
    }
    
    if (results.length > 0) {
      log.info('DuckDuckGo instant succeeded', { results: results.length })
    }
    return results
  } catch {}
  return []
}

// ── Main search with fallbacks and cache ────────────────────────────────────

/**
 * Web search using multiple free APIs (no key needed).
 * Tries: SearXNG → Wikipedia search → DuckDuckGo instant.
 * Results cached for 1 hour.
 */
export async function webSearch(
  query: string,
  maxResults = 8,
): Promise<Array<{ title: string; url: string; snippet: string }>> {
  log.info('Web search', { query })

  // Check cache first
  const cached = getCached(query)
  if (cached) return cached.slice(0, maxResults)

  // Try SearXNG public instances
  const searxngInstances = [
    'https://search.inetol.net',
    'https://search.bus-hit.me',
    'https://searx.be',
    'https://searx.tiekoetter.com',
    'https://search.sapti.me',
  ]

  for (const instance of searxngInstances) {
    try {
      const resp = await fetch(`${instance}/search?q=${encodeURIComponent(query)}&format=json`, {
        headers: { 'Accept': 'application/json', 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(8000),
      })
      if (resp.ok) {
        const data = await resp.json() as any
        if (data.results?.length > 0) {
          const results = data.results.slice(0, maxResults).map((r: any) => ({
            title: r.title || '',
            url: r.url || '',
            snippet: (r.content || '').slice(0, 300),
          }))
          setCache(query, results)
          return results
        }
      }
    } catch {}
  }

  // Fallback 1: Wikipedia search API
  const wikiResults = await wikipediaSearch(query, maxResults)
  if (wikiResults.length > 0) {
    setCache(query, wikiResults)
    return wikiResults
  }

  // Fallback 2: DuckDuckGo instant answers
  const ddgResults = await duckduckgoInstant(query)
  if (ddgResults.length > 0) {
    setCache(query, ddgResults)
    return ddgResults
  }

  log.warn('All search backends failed', { query })
  return []
}

/**
 * Scrape with Playwright — for JS-rendered pages.
 * Only called when explicitly requested or when fetch fails.
 */
export async function scrapeWebpage(
  url: string,
  options?: { waitForMs?: number; screenshot?: boolean },
): Promise<WebResearchResult> {
  // Lazy import — only loads Playwright when needed
  const { scrapeWithPlaywright } = await import('./playwright-scraper.js')
  
  const result = await scrapeWithPlaywright(url, {
    waitForMs: options?.waitForMs ?? 3000,
    screenshot: options?.screenshot ?? false,
    timeoutMs: 30_000,
  })

  return {
    url: result.url,
    title: result.title,
    text: result.text,
    links: result.links,
    tables: [],
    jsRendered: true,
    fetchedAt: result.fetchedAt,
  }
}

/**
 * Search and fetch — combines search with content extraction.
 * Falls back to Playwright for pages that fail with fetch.
 */
export async function researchTopic(
  query: string,
  fetchTop = 3,
): Promise<{
  query: string
  searchResults: Array<{ title: string; url: string; snippet: string }>
  fetchedPages: WebResearchResult[]
}> {
  const searchResults = await webSearch(query, 8)
  const fetchedPages: WebResearchResult[] = []

  // Fetch top N results for deeper content
  for (const result of searchResults.slice(0, fetchTop)) {
    try {
      const page = await fetchWebpage(result.url)
      fetchedPages.push(page)
    } catch (e: any) {
      log.warn('Fetch failed, trying Playwright', { url: result.url, error: e.message })
      // Fallback: try Playwright for JS-rendered pages
      try {
        const page = await scrapeWebpage(result.url)
        fetchedPages.push(page)
      } catch (pwError: any) {
        log.warn('Playwright also failed', { url: result.url, error: pwError.message })
      }
    }
  }

  return { query, searchResults, fetchedPages }
}
