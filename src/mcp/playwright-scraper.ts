/**
 * src/mcp/playwright-scraper.ts
 *
 * Optional Playwright-based web scraper.
 * Uses playwright-core (no bundled browsers) — picks up Chrome/Edge/Firefox
 * already installed on the system.
 *
 * WHY THIS EXISTS:
 *   The default fetch + cheerio scraper can't handle:
 *   - Single-page apps (React, Vue, Angular) that render client-side
 *   - Pages requiring JavaScript to load content
 *   - Infinite scroll pages
 *   - Pages behind simple JavaScript redirects
 *
 * MEMORY SAFETY:
 *   - Lazy-loads Playwright only when called (not at startup)
 *   - Launches browser in headless mode with minimal memory (~200MB)
 *   - Auto-closes browser after each scrape
 *   - Sets hard timeout to prevent hanging
 *
 * USAGE:
 *   import { scrapeWithPlaywright } from './playwright-scraper.js'
 *   const result = await scrapeWithPlaywright('https://spa-example.com')
 */

import { createLogger } from '../observability/logger.js'
import { homedir } from 'os'
import { existsSync } from 'fs'

const log = createLogger('mcp:playwright')

// Lazy-loaded Playwright — only imported when first used
let playwrightModule: any = null

async function getPlaywright() {
  if (!playwrightModule) {
    try {
      playwrightModule = await import('playwright-core')
    } catch (e: any) {
      throw new Error(
        'playwright-core not installed. Run: npm install playwright-core\n' +
        'Also install a browser: npx playwright install chromium'
      )
    }
  }
  return playwrightModule
}

export interface PlaywrightResult {
  url: string
  title: string
  text: string
  html: string
  links: Array<{ text: string; href: string }>
  screenshot?: Buffer
  jsEnabled: boolean
  timeout: boolean
  fetchedAt: number
}

/**
 * Detect which browser is available on the system.
 * Prefers Edge on Windows, Chrome on all platforms, then Firefox.
 */
function detectBrowser(): string {
  const platform = process.platform
  const home = homedir()

  const candidates: Array<{ name: string; path: string }> = []

  if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || `${home}\\AppData\\Local`
    const pf = process.env['PROGRAMFILES'] || 'C:\\Program Files'
    const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'
    candidates.push(
      { name: 'chrome', path: `${pf}\\Google\\Chrome\\Application\\chrome.exe` },
      { name: 'msedge', path: `${pf86}\\Microsoft\\Edge\\Application\\msedge.exe` },
      { name: 'chrome-local', path: `${localAppData}\\Google\\Chrome\\Application\\chrome.exe` },
      { name: 'msedge-local', path: `${localAppData}\\Microsoft\\Edge\\Application\\msedge.exe` },
    )
  } else if (platform === 'darwin') {
    candidates.push(
      { name: 'chrome', path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
      { name: 'firefox', path: '/Applications/Firefox.app/Contents/MacOS/firefox' },
    )
  } else {
    candidates.push(
      { name: 'chromium', path: '/usr/bin/chromium-browser' },
      { name: 'chrome', path: '/usr/bin/google-chrome' },
      { name: 'firefox', path: '/usr/bin/firefox' },
    )
  }

  for (const c of candidates) {
    try {
      if (existsSync(c.path)) {
        log.info('Found browser', { name: c.name, path: c.path })
        return c.path
      }
    } catch {}
  }

  return '' // no browser found
}

/**
 * Scrape a page with Playwright.
 * Renders JavaScript and extracts the final page content.
 *
 * @param url - URL to scrape
 * @param options - Scraping options
 */
export async function scrapeWithPlaywright(
  url: string,
  options: {
    waitForMs?: number    // wait after page load for JS to render (default 2000)
    timeoutMs?: number    // overall timeout (default 30000)
    screenshot?: boolean  // capture screenshot (default false)
    maxChars?: number     // max text chars to return (default 10000)
  } = {},
): Promise<PlaywrightResult> {
  const {
    waitForMs = 2000,
    timeoutMs = 30_000,
    screenshot = false,
    maxChars = 10_000,
  } = options

  log.info('Playwright scrape', { url, waitForMs })

  const pw = await getPlaywright()
  const browserPath = detectBrowser()

  if (!browserPath) {
    throw new Error(
      'No browser found. Install Chrome, Edge, or Firefox, ' +
      'or run: npx playwright install chromium'
    )
  }

  let browser: any = null
  let timeout = false

  try {
    browser = await pw.chromium.launch({
      executablePath: browserPath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',  // critical for low RAM
        '--disable-extensions',
        '--disable-background-networking',
      ],
    })

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
      javaScriptEnabled: true,
    })

    const page = await context.newPage()

    // Block heavy resources to save memory
    await page.route('**/*.{png,jpg,jpeg,gif,svg,webp,mp4,webm,woff,woff2,ttf}', (route: any) => route.abort())
    await page.route('**/ads/**', (route: any) => route.abort())
    await page.route('**/analytics/**', (route: any) => route.abort())

    // Navigate with timeout
    const timer = setTimeout(() => { timeout = true }, timeoutMs)

    try {
      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: timeoutMs,
      })
    } catch (e: any) {
      // networkidle timeout is OK — page may still have content
      log.warn('Page load timed out, continuing', { error: e.message })
    }

    // Wait for JS to render
    if (waitForMs > 0) {
      await page.waitForTimeout(waitForMs)
    }

    clearTimeout(timer)

    // Extract content
    const title = await page.title()
    const text: string = await page.evaluate(() => {
      // @ts-expect-error - runs in browser context where document exists
      const el = (document.body as any)?.cloneNode(true)
      if (!el) return ''
      el.querySelectorAll('script, style, nav, footer, header, aside, noscript').forEach((e: any) => e.remove())
      return (el.innerText || '').replace(/\s+/g, ' ').trim() || ''
    })

    const links: Array<{ text: string; href: string }> = await page.evaluate(() => {
      // @ts-expect-error - runs in browser context where document exists
      return Array.from(document.querySelectorAll('a[href]'))
        .map((a: any) => ({
          text: (a.innerText || '').trim().slice(0, 100),
          href: a.href || '',
        }))
        .filter((l: any) => l.text && l.href && !l.href.startsWith('javascript:'))
        .slice(0, 50)
    })

    let screenshotBuffer: Buffer | undefined
    if (screenshot) {
      screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 80 }) as Buffer
    }

    return {
      url,
      title,
      text: text.slice(0, maxChars),
      html: '', // not extracted to save memory
      links,
      screenshot: screenshotBuffer,
      jsEnabled: true,
      timeout,
      fetchedAt: Date.now(),
    }
  } finally {
    if (browser) {
      try {
        await browser.close()
      } catch {}
    }
  }
}

/**
 * Check if Playwright is available and a browser is installed.
 */
export async function isPlaywrightAvailable(): Promise<boolean> {
  try {
    await getPlaywright()
    return detectBrowser() !== ''
  } catch {
    return false
  }
}
