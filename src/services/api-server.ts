/**
 * HTTP API Server — Minimal Express-like API for the platform
 * Endpoints: /search, /extract, /analyze, /providers, /health
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { searchWeb } from './search.js'
import { extractWebpage } from './web-extractor.js'
import { runPipeline } from './pipeline.js'
import { getAvailableProviders, getRateLimitStatus } from '../providers/index.js'

const PORT = parseInt(process.env.API_PORT || '3001', 10)

function parseBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()))
      } catch {
        resolve({})
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, data: any) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  res.end(JSON.stringify(data, null, 2))
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`)

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    })
    return res.end()
  }

  try {
    // GET /health
    if (url.pathname === '/health' && req.method === 'GET') {
      return sendJson(res, 200, {
        status: 'ok',
        providers: getAvailableProviders(),
        rateLimits: getRateLimitStatus(),
      })
    }

    // GET /providers
    if (url.pathname === '/providers' && req.method === 'GET') {
      return sendJson(res, 200, {
        available: getAvailableProviders(),
        rateLimits: getRateLimitStatus(),
      })
    }

    // POST /search
    if (url.pathname === '/search' && req.method === 'POST') {
      const body = await parseBody(req)
      if (!body.query) return sendJson(res, 400, { error: 'query required' })

      const results = await searchWeb(body.query, body.maxResults ?? 10)
      return sendJson(res, 200, { query: body.query, results })
    }

    // POST /extract
    if (url.pathname === '/extract' && req.method === 'POST') {
      const body = await parseBody(req)
      if (!body.url) return sendJson(res, 400, { error: 'url required' })

      const page = await extractWebpage(body.url)
      return sendJson(res, 200, page)
    }

    // POST /analyze (full pipeline)
    if (url.pathname === '/analyze' && req.method === 'POST') {
      const body = await parseBody(req)
      if (!body.query) return sendJson(res, 400, { error: 'query required' })

      const result = await runPipeline(body.query, {
        maxSearchResults: body.maxResults ?? 5,
        maxExtractPages: body.maxExtract ?? 3,
        systemPrompt: body.systemPrompt,
      })
      return sendJson(res, 200, result)
    }

    // 404
    sendJson(res, 404, { error: 'Not found', endpoints: ['/health', '/providers', '/search', '/extract', '/analyze'] })
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : 'Internal error' })
  }
})

server.listen(PORT, () => {
  console.log(`\n  🌐 Platform API running at http://localhost:${PORT}`)
  console.log(`  Endpoints:`)
  console.log(`    GET  /health    — Provider status + rate limits`)
  console.log(`    GET  /providers — Available providers`)
  console.log(`    POST /search    — DuckDuckGo search`)
  console.log(`    POST /extract   — Web page extraction`)
  console.log(`    POST /analyze   — Full search+extract+infer pipeline`)
  console.log()
})
