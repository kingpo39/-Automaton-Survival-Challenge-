/**
 * Web Extractor — Cheerio (fast) + Playwright (JS rendering) fallback
 * Extracts text, links, and metadata from any URL.
 */

import * as cheerio from 'cheerio'

export interface ExtractedPage {
  url: string
  title: string
  text: string
  links: Array<{ text: string; href: string }>
  meta: Record<string, string>
  extractor: 'cheerio' | 'playwright'
  charCount: number
}

/**
 * Extract content from a URL using Cheerio (fast, no browser).
 * Falls back to Playwright for JS-rendered pages.
 */
export async function extractWebpage(url: string): Promise<ExtractedPage> {
  try {
    return await extractWithCheerio(url)
  } catch (cheerioError) {
    // Cheerio failed — try Playwright for JS-rendered pages
    try {
      return await extractWithPlaywright(url)
    } catch (playwrightError) {
      throw new Error(
        `Failed to extract ${url}: ` +
        `Cheerio: ${cheerioError instanceof Error ? cheerioError.message : 'unknown'}, ` +
        `Playwright: ${playwrightError instanceof Error ? playwrightError.message : 'unknown'}`
      )
    }
  }
}

/**
 * Fast extraction with Cheerio (no browser needed).
 */
async function extractWithCheerio(url: string): Promise<ExtractedPage> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(15000),
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  const html = await response.text()
  const $ = cheerio.load(html)

  // Remove unwanted elements
  $('script, style, nav, footer, header, aside, noscript, iframe').remove()

  // Extract title
  const title = $('title').text().trim() ||
    $('h1').first().text().trim() ||
    'Untitled'

  // Extract main text
  const text = $('body')
    .text()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50000) // Limit to 50k chars

  // Extract links
  const links: Array<{ text: string; href: string }> = []
  $('a[href]').each((_, el) => {
    const linkText = $(el).text().trim().slice(0, 100)
    const href = $(el).attr('href') || ''
    if (linkText && href && !href.startsWith('javascript:') && !href.startsWith('#')) {
      links.push({ text: linkText, href })
    }
  })

  // Extract meta tags
  const meta: Record<string, string> = {}
  $('meta[name], meta[property]').each((_, el) => {
    const key = $(el).attr('name') || $(el).attr('property') || ''
    const value = $(el).attr('content') || ''
    if (key && value) meta[key] = value
  })

  return {
    url,
    title,
    text,
    links: links.slice(0, 50),
    meta,
    extractor: 'cheerio',
    charCount: text.length,
  }
}

/**
 * Heavy extraction with Playwright (for JS-rendered pages).
 */
async function extractWithPlaywright(url: string): Promise<ExtractedPage> {
  // Dynamic import — only loads when needed
  const { chromium } = await import('playwright-core')

  // Find Chrome on Windows
  const chromePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ]

  let executablePath: string | undefined
  const fs = await import('fs')
  for (const p of chromePaths) {
    if (fs.existsSync(p)) {
      executablePath = p
      break
    }
  }

  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })

  try {
    const page = await browser.newPage()

    // Block heavy resources
    await page.route('**/*.{png,jpg,jpeg,gif,svg,webp,mp4,woff,woff2}', (route: any) => route.abort())

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })

    // Extract content
    const title = await page.title()
    const text: string = await page.evaluate(() => { 
      // @ts-ignore - runs in browser context
      const el = (globalThis as any).document.body?.cloneNode(true) as any
      if (!el) return ''
      el.querySelectorAll('script, style, nav, footer, header, aside, noscript').forEach((e: any) => e.remove())
      return (el.innerText || '').replace(/\s+/g, ' ').trim() || ''
    })

    const links: Array<{ text: string; href: string }> = await page.evaluate(() => {
      return Array.from((globalThis as any).document.querySelectorAll('a[href]'))
        .map((a: any) => ({
          text: (a.innerText || '').trim().slice(0, 100),
          href: a.href || '',
        }))
        .filter((l: any) => l.text && l.href && !l.href.startsWith('javascript:'))
        .slice(0, 50)
    })

    return {
      url,
      title: title || 'Untitled',
      text: text.slice(0, 50000),
      links,
      meta: {},
      extractor: 'playwright',
      charCount: text.length,
    }
  } finally {
    await browser.close()
  }
}
