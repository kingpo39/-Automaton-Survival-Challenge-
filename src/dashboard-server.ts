/**
 * dashboard-server.ts
 * Lightweight HTTP + WebSocket server:
 * 1. Serves deposit dashboard HTML
 * 2. Proxies Base RPC calls (no CORS)
 * 3. WebSocket pushes real-time balance updates
 * 4. Polls blockchain every 15s
 */

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { OpinionEngine } from './opinion/engine.js'

const PORT = 9876
const WALLET = '0x87716cE61c5Ff42e441B180Aa475fAD48Ca832ed'
const USDC_CONTRACT = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

const RPC_ENDPOINTS = [
  'https://base.publicnode.com',
  'https://1rpc.io/base',
  'https://base.drpc.org',
  'https://base.llamarpc.com',
]

let rpcIndex = 0

// ── RPC Proxy ────────────────────────────────────────────────────────────

async function rpcCall(method: string, params: any[]): Promise<any> {
  for (let i = 0; i < RPC_ENDPOINTS.length; i++) {
    const url = RPC_ENDPOINTS[(rpcIndex + i) % RPC_ENDPOINTS.length]
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: controller.signal,
      })
      clearTimeout(timeout)
      const text = await resp.text()
      // Skip HTML responses (rate limit pages, error pages)
      if (text.startsWith('<')) continue
      const data: any = JSON.parse(text)
      if (data.error) throw new Error(data.error.message)
      rpcIndex = (rpcIndex + i) % RPC_ENDPOINTS.length
      return data.result
    } catch (e: any) {
      if (i === RPC_ENDPOINTS.length - 1) throw e
    }
  }
  throw new Error('All RPC endpoints failed')
}

async function getBalance() {
  const paddedAddr = WALLET.slice(2).toLowerCase().padStart(64, '0')
  const [usdcRaw, ethRaw] = await Promise.all([
    rpcCall('eth_call', [{ to: USDC_CONTRACT, data: '0x70a08231' + paddedAddr }, 'latest']),
    rpcCall('eth_getBalance', [WALLET, 'latest']),
  ])
  return {
    usdcCents: Math.round((parseInt(usdcRaw, 16) / 1e6) * 100),
    ethWei: parseInt(ethRaw, 16),
    wallet: WALLET,
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString()))
    req.on('error', reject)
  })
}

// ── HTTP Server ──────────────────────────────────────────────────────────

// ── Chat Message Store ────────────────────────────────────────────────────
interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  ts: number
  processed: boolean
}
const chatMessages: ChatMessage[] = []
let chatIdCounter = 0
let streamingMsgId: string | null = null

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`)

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  // ── Chat: Send message from user ──
  if (url.pathname === '/chat/send' && req.method === 'POST') {
    try {
      const body = await readBody(req)
      const { content } = JSON.parse(body)
      if (!content || typeof content !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'content required' }))
        return
      }
      const msg: ChatMessage = {
        id: `chat-${++chatIdCounter}`,
        role: 'user',
        content: content.slice(0, 2000),
        ts: Date.now(),
        processed: false,
      }
      chatMessages.push(msg)
      if (chatMessages.length > 200) chatMessages.shift()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, id: msg.id }))
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
    return
  }

  // ── Chat: Get pending messages for agent to process ──
  if (url.pathname === '/chat/pending' && req.method === 'GET') {
    try {
      const pending = chatMessages.filter(m => m.role === 'user' && !m.processed)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ messages: pending }))
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
    return
  }

  // ── Chat: Agent posts response ──
  if (url.pathname === '/chat/respond' && req.method === 'POST') {
    try {
      const body = await readBody(req)
      const { replyTo, content } = JSON.parse(body)
      // Mark the user message as processed
      if (replyTo) {
        const userMsg = chatMessages.find(m => m.id === replyTo)
        if (userMsg) userMsg.processed = true
      }
      const msg: ChatMessage = {
        id: `chat-${++chatIdCounter}`,
        role: 'assistant',
        content: (content || '').slice(0, 4000),
        ts: Date.now(),
        processed: true,
      }
      chatMessages.push(msg)
      if (chatMessages.length > 200) chatMessages.shift()
      // Broadcast to WebSocket clients
      for (const client of wss.clients) {
        if (client.readyState === 1) {
          client.send(JSON.stringify({ type: 'chat', ...msg }))
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
    return
  }

  // ── Chat: Streaming tokens ──
  // Agent POSTs partial tokens as it generates them.
  // Actions: 'start' (create bubble), 'token' (append text), 'done' (finalize)
  if (url.pathname === '/chat/stream' && req.method === 'POST') {
    try {
      const body = await readBody(req)
      const { action, replyTo, content, token } = JSON.parse(body)

      if (action === 'start') {
        // Mark user message as processed
        if (replyTo) {
          const userMsg = chatMessages.find(m => m.id === replyTo)
          if (userMsg) userMsg.processed = true
        }
        // Create a streaming assistant message with empty content
        const msg: ChatMessage = {
          id: `chat-${++chatIdCounter}`,
          role: 'assistant',
          content: '',
          ts: Date.now(),
          processed: false,
        }
        chatMessages.push(msg)
        // Store streaming ID for subsequent tokens
        streamingMsgId = msg.id
        // Broadcast start event
        for (const client of wss.clients) {
          if (client.readyState === 1) {
            client.send(JSON.stringify({ type: 'chat_stream_start', id: msg.id, replyTo }))
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, id: msg.id }))
      } else if (action === 'token') {
        // Append token to the streaming message
        const msg = chatMessages.find(m => m.id === streamingMsgId)
        if (msg && token) {
          msg.content += token
          // Broadcast token to all WebSocket clients
          for (const client of wss.clients) {
            if (client.readyState === 1) {
              client.send(JSON.stringify({ type: 'chat_stream_token', id: msg.id, token }))
            }
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } else if (action === 'done') {
        // Finalize the streaming message
        const msg = chatMessages.find(m => m.id === streamingMsgId)
        if (msg) {
          msg.processed = true
          msg.content = (content || msg.content).slice(0, 4000)
          // Broadcast done event with final content
          for (const client of wss.clients) {
            if (client.readyState === 1) {
              client.send(JSON.stringify({ type: 'chat_stream_done', id: msg.id, content: msg.content }))
            }
          }
        }
        streamingMsgId = null
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } else if (action === 'research_start') {
        // Auto-research is fetching results — show 'Researching...' indicator
        for (const client of wss.clients) {
          if (client.readyState === 1) {
            client.send(JSON.stringify({ type: 'research_status', status: 'searching', category: content || '' }))
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } else if (action === 'research_done') {
        // Auto-research finished — hide indicator, show result count
        for (const client of wss.clients) {
          if (client.readyState === 1) {
            client.send(JSON.stringify({ type: 'research_status', status: 'done', resultsCount: content || 0 }))
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid action' }))
      }
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
    return
  }

  // ── Chat: Get all messages ──
  if (url.pathname === '/chat/messages' && req.method === 'GET') {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ messages: chatMessages.slice(-50) }))
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
    return
  }

  // RPC proxy
  if (url.pathname === '/rpc' && req.method === 'POST') {
    try {
      const body = await readBody(req)
      const { method, params } = JSON.parse(body)
      const result = await rpcCall(method, params || [])
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ result }))
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
    return
  }

  // Opinion history endpoint — 24h of momentum snapshots
  if (url.pathname === '/opinion/history') {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ history: opinionHistoryBuf }))
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
    return
  }

  // Opinion endpoint — uses shared OpinionEngine
  if (url.pathname === '/opinion') {
    try {
      recordOpinionSnapshot()  // also record on each live poll
      const state = opinionEngine.getState()
      const topKw = state.topKeywords.slice(0, 8).map(k => ({
        word: k.keyword,
        count: state.topKeywords.filter(kk => kk.keyword === k.keyword).length,
        score: k.weight,
      }))
      // Deduplicate keywords
      const seen = new Set<string>()
      const uniqueKw = topKw.filter(k => { if (seen.has(k.word)) return false; seen.add(k.word); return true })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        momentum: state.momentum,
        confidence: state.confidence,
        volume: state.volume,
        velocity: state.velocity,
        keywords: uniqueKw,
        sourceBreakdown: state.sourceBreakdown,
      }))
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
    return
  }

  // Balance endpoint
  if (url.pathname === '/balance') {
    try {
      const balance = await getBalance()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(balance))
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
    return
  }

  // Dashboard HTML
  const htmlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'deposit-dashboard.html')
  try {
    const html = fs.readFileSync(htmlPath, 'utf-8')
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(html)
  } catch {
    res.writeHead(404)
    res.end('Dashboard not found')
  }
})

// ── WebSocket Server ─────────────────────────────────────────────────────

const wss = new WebSocketServer({ server })

wss.on('connection', (ws) => {
  console.log('[ws] client connected (' + wss.clients.size + ' total)')
  ws.send(JSON.stringify({ type: 'status', msg: 'Connected to dashboard server' }))

  // Send initial balance
  getBalance().then(balance => {
    ws.send(JSON.stringify({ type: 'balance', ...balance, pollCount }))
  }).catch(() => {})

  ws.on('close', () => {
    console.log('[ws] client disconnected (' + wss.clients.size + ' remaining)')
  })
})

// ── Periodic Polling ─────────────────────────────────────────────────────

let lastUsdc = 0
let pollCount = 0

// ── Opinion Engine (shared with agent) ───────────────────────────────────
const opinionEngine = new OpinionEngine()
opinionEngine.start()
console.log('[opinion] engine started — polling Reddit, HN, Ars Technica, LessWrong')

// ── Opinion History Ring Buffer (24h at 5-min intervals = 288 points) ──
interface OpinionSnapshot {
  ts: number        // timestamp ms
  momentum: number  // -1 to +1
  confidence: number
  volume: number
  velocity: number
}
const OPINION_HISTORY_MAX = 288  // 24h at 5-min intervals
const opinionHistoryBuf: OpinionSnapshot[] = []
let lastOpinionSnapshot = 0
const OPINION_SNAPSHOT_INTERVAL = 5 * 60_000  // 5 minutes

function recordOpinionSnapshot(): void {
  const now = Date.now()
  if (now - lastOpinionSnapshot < OPINION_SNAPSHOT_INTERVAL) return
  lastOpinionSnapshot = now
  const state = opinionEngine.getState()
  opinionHistoryBuf.push({
    ts: now,
    momentum: state.momentum,
    confidence: state.confidence,
    volume: state.volume,
    velocity: state.velocity,
  })
  if (opinionHistoryBuf.length > OPINION_HISTORY_MAX) {
    opinionHistoryBuf.shift()
  }
}

// Record first snapshot after engine warms up (30s)
setTimeout(recordOpinionSnapshot, 30_000)
setInterval(recordOpinionSnapshot, 60_000)  // check every minute, record every 5min

async function pollAndBroadcast() {
  try {
    const balance = await getBalance()
    pollCount++

    // Broadcast to all WebSocket clients
    for (const client of wss.clients) {
      if (client.readyState === 1) { // OPEN
        client.send(JSON.stringify({
          type: 'balance',
          usdcCents: balance.usdcCents,
          ethWei: balance.ethWei,
          pollCount,
          timestamp: Date.now(),
        }))
      }
    }

    // Detect deposits
    if (lastUsdc > 0 && balance.usdcCents > lastUsdc) {
      const deposit = {
        type: 'deposit',
        amount: balance.usdcCents - lastUsdc,
        newBalance: balance.usdcCents,
      }
      for (const client of wss.clients) {
        if (client.readyState === 1) {
          client.send(JSON.stringify(deposit))
        }
      }
    }

    lastUsdc = balance.usdcCents
  } catch (e: any) {
    console.error('[poll] error:', e.message)
  }
}

// ── Start ────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`\n🧬 Survival Dashboard Server`)
  console.log(`   URL:      http://localhost:${PORT}`)
  console.log(`   Wallet:   ${WALLET}`)
  console.log(`   Network:  Base L2`)
  console.log(`   RPC:      ${RPC_ENDPOINTS[0]}`)
  console.log(`   Polling:  every 15s`)
  console.log(`   WS:       ws://localhost:${PORT}/ws\n`)
})

// Immediate first poll, then every 15s
pollAndBroadcast()
setInterval(pollAndBroadcast, 15_000)
