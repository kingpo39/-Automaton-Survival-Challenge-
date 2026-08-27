/**
 * DuckDuckGo Search Service — Free, no API key required
 */

export interface SearchResult {
  title: string
  url: string
  snippet: string
}

/**
 * Search DuckDuckGo and return top results.
 */
export async function searchWeb(query: string, maxResults = 10): Promise<SearchResult[]> {
  const results: SearchResult[] = []

  try {
    const params = new URLSearchParams({ q: query, kl: 'us-en' })
    const response = await fetch(`https://lite.duckduckgo.com/lite?${params}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(10000),
    })

    if (response.ok) {
      const html = await response.text()

      // DDG lite result format:
      // <a rel="nofollow" href="//duckduckgo.com/l/?uddg=ENCODED_URL..." class='result-link'>TITLE</a>
      const pattern = /<a\s+rel="nofollow"\s+href="([^"]+)"\s+class='result-link'>([^<]+)<\/a>/gi
      let m: RegExpExecArray | null

      while ((m = pattern.exec(html)) !== null && results.length < maxResults) {
        let href = m[1]
        const title = m[2].trim()

        // Extract real URL from DDG redirect
        const uddg = href.match(/uddg=([^&]+)/)
        if (uddg) {
          href = decodeURIComponent(uddg[1])
        } else if (href.startsWith('//')) {
          href = 'https:' + href
        }

        if (title && href.startsWith('http') && !href.includes('duckduckgo.com')) {
          results.push({ title, url: href, snippet: title })
        }
      }

      // Also grab zero-click info if present
      if (results.length === 0) {
        const zeroClick = html.match(/Zero-click info:.*?<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/i)
        if (zeroClick) {
          results.push({ title: zeroClick[2], url: zeroClick[1], snippet: zeroClick[2] })
        }
      }
    }
  } catch {
    // HTML search failed
  }

  // Fallback: JSON instant answer API
  if (results.length === 0) {
    try {
      const jsonResp = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`,
        { signal: AbortSignal.timeout(5000) }
      )
      if (jsonResp.ok) {
        const data = await jsonResp.json() as {
          AbstractText?: string; AbstractURL?: string
          RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>
        }
        if (data.AbstractText && data.AbstractURL) {
          results.push({ title: query, url: data.AbstractURL, snippet: data.AbstractText })
        }
        for (const t of (data.RelatedTopics || []).slice(0, maxResults - results.length)) {
          if (t.Text && t.FirstURL) {
            results.push({ title: t.Text.slice(0, 100), url: t.FirstURL, snippet: t.Text })
          }
        }
      }
    } catch { /* both failed */ }
  }

  return results.slice(0, maxResults)
}
