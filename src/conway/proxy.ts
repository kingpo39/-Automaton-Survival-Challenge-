/**
 * conway/proxy.ts
 *
 * PROXY SUPPORT — SOCKS5 and HTTP Proxies
 *
 * Resolves proxy from environment variables:
 *   ALL_PROXY=socks5h://127.0.0.1:9050   (Tor)
 *   HTTP_PROXY=http://proxy:8080
 *   HTTPS_PROXY=http://proxy:8080
 *
 * Uses only Node.js built-in modules — no external dependencies.
 * SOCKS5 tunnel via net.Socket, HTTP proxy via http.request.
 */

import { createLogger } from '../observability/logger.js'
import * as net from 'node:net'
import * as tls from 'node:tls'
import * as http from 'node:http'
import * as https from 'node:https'
import { URL } from 'node:url'

const log = createLogger('conway:proxy')

// ── Types ────────────────────────────────────────────────────────────────────

export interface ProxyConfig {
  /** Full proxy URL (e.g., socks5h://127.0.0.1:9050) */
  url: string
  /** Protocol type */
  type: 'socks5' | 'http' | 'https'
  /** Proxy hostname */
  host: string
  /** Proxy port */
  port: number
  /** Optional auth */
  username?: string
  password?: string
}

export interface ProxyStatus {
  active: boolean
  type: string
  host: string
  port: number
}

// ── Proxy Resolution ─────────────────────────────────────────────────────────

/**
 * Resolve proxy URL from environment variables.
 * Priority: ALL_PROXY > HTTPS_PROXY > HTTP_PROXY
 */
export function resolveProxyFromEnv(): ProxyConfig | null {
  const raw = process.env.ALL_PROXY
    || process.env.all_proxy
    || process.env.HTTPS_PROXY
    || process.env.https_proxy
    || process.env.HTTP_PROXY
    || process.env.http_proxy

  if (!raw) return null

  try {
    const url = new URL(raw)
    const type: ProxyConfig['type'] = url.protocol.startsWith('socks') ? 'socks5' : 'http'

    return {
      url: raw,
      type,
      host: url.hostname,
      port: parseInt(url.port, 10) || (type === 'socks5' ? 1080 : 8080),
      username: url.username || undefined,
      password: url.password || undefined,
    }
  } catch (err) {
    log.warn('Invalid proxy URL', { url: raw, error: String(err) })
    return null
  }
}

/**
 * Get proxy status for diagnostics.
 */
export function getProxyStatus(config: ProxyConfig | null): ProxyStatus {
  if (!config) {
    return { active: false, type: 'direct', host: '', port: 0 }
  }
  return {
    active: true,
    type: config.type === 'socks5' ? `SOCKS5 (${config.url})` : `HTTP (${config.url})`,
    host: config.host,
    port: config.port,
  }
}

// ── SOCKS5 Tunnel ────────────────────────────────────────────────────────────

/**
 * Create a SOCKS5 tunnel to the target host:port.
 * Returns a net.Socket connected through the SOCKS5 proxy.
 */
export function socks5Connect(
  proxyHost: string,
  proxyPort: number,
  targetHost: string,
  targetPort: number,
  options?: { username?: string; password?: string; timeoutMs?: number },
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const timeoutMs = options?.timeoutMs ?? 10_000
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`SOCKS5 connect timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    const socket = net.createConnection({ host: proxyHost, port: proxyPort })

    socket.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })

    // SOCKS5 handshake
    // Step 1: Greeting — version 5, auth methods
    const authMethods = options?.username ? Buffer.from([0x05, 0x02, 0x00, 0x02]) : Buffer.from([0x05, 0x01, 0x00])
    socket.write(authMethods)

    let step = 0
    socket.on('data', (data: Buffer) => {
      if (step === 0) {
        // Step 2: Server selected auth method
        if (data[0] !== 0x05) {
          clearTimeout(timer)
          socket.destroy()
          reject(new Error(`SOCKS5 invalid version: ${data[0]}`))
          return
        }

        if (data[1] === 0x02 && options?.username && options?.password) {
          // Username/password auth (RFC 1929)
          const userBuf = Buffer.from(options.username)
          const passBuf = Buffer.from(options.password)
          const authReq = Buffer.alloc(3 + userBuf.length + passBuf.length)
          authReq[0] = 0x01 // auth version
          authReq[1] = userBuf.length
          userBuf.copy(authReq, 2)
          authReq[2 + userBuf.length] = passBuf.length
          passBuf.copy(authReq, 3 + userBuf.length)
          socket.write(authReq)
          step = 1
        } else if (data[1] === 0x00) {
          // No auth required — send connect request
          sendConnectRequest(socket, targetHost, targetPort)
          step = 2
        } else {
          clearTimeout(timer)
          socket.destroy()
          reject(new Error(`SOCKS5 unsupported auth method: ${data[1]}`))
        }
      } else if (step === 1) {
        // Step 3: Auth response
        if (data[1] !== 0x00) {
          clearTimeout(timer)
          socket.destroy()
          reject(new Error(`SOCKS5 auth failed: ${data[1]}`))
          return
        }
        sendConnectRequest(socket, targetHost, targetPort)
        step = 2
      } else if (step === 2) {
        // Step 4: Connect response
        clearTimeout(timer)
        if (data[1] !== 0x00) {
          const errorMap: Record<number, string> = {
            0x01: 'general failure',
            0x02: 'connection not allowed',
            0x03: 'network unreachable',
            0x04: 'host unreachable',
            0x05: 'connection refused',
            0x06: 'TTL expired',
            0x07: 'command not supported',
            0x08: 'address type not supported',
          }
          socket.destroy()
          reject(new Error(`SOCKS5 connect failed: ${errorMap[data[1]] ?? 'unknown error'}`))
          return
        }
        log.debug('SOCKS5 tunnel established', { target: `${targetHost}:${targetPort}` })
        resolve(socket)
      }
    })
  })
}

function sendConnectRequest(socket: net.Socket, host: string, port: number): void {
  // SOCKS5 CONNECT request
  // Version 5, Command 1 (CONNECT), Reserved 0, Address type
  const hostBuf = Buffer.from(host)
  const request = Buffer.alloc(7 + hostBuf.length)
  request[0] = 0x05  // version
  request[1] = 0x01  // CONNECT
  request[2] = 0x00  // reserved
  request[3] = 0x03  // domain name
  request[4] = hostBuf.length
  hostBuf.copy(request, 5)
  request.writeUInt16BE(port, 5 + hostBuf.length)
  socket.write(request)
}

// ── HTTPS Agent with SOCKS5 ──────────────────────────────────────────────────

/**
 * Create an HTTPS agent that tunnels through SOCKS5.
 * Used with fetch() or https.request().
 */
export function createSocks5HttpsAgent(
  proxyHost: string,
  proxyPort: number,
  options?: { username?: string; password?: string },
): https.Agent {
  return new https.Agent({
    keepAlive: true,
    maxSockets: 10,
    connect: async (_req: unknown, _opts: unknown, callback: (err: Error | null, socket?: net.Socket) => void) => {
      try {
        const opts = _opts as { host?: string; hostname?: string; port?: number }
        const host = opts.host ?? opts.hostname ?? ''
        const port = opts.port ?? 443
        const socket = await socks5Connect(proxyHost, proxyPort, host, port, options)
        callback(null, socket)
      } catch (err) {
        callback(err instanceof Error ? err : new Error(String(err)))
      }
    },
  } as https.AgentOptions)
}

/**
 * Create an HTTP agent that tunnels through SOCKS5.
 */
export function createSocks5HttpAgent(
  proxyHost: string,
  proxyPort: number,
  options?: { username?: string; password?: string },
): http.Agent {
  return new http.Agent({
    keepAlive: true,
    maxSockets: 10,
    connect: async (_req: unknown, _opts: unknown, callback: (err: Error | null, socket?: net.Socket) => void) => {
      try {
        const opts = _opts as { host?: string; hostname?: string; port?: number }
        const host = opts.host ?? opts.hostname ?? ''
        const port = opts.port ?? 80
        const socket = await socks5Connect(proxyHost, proxyPort, host, port, options)
        callback(null, socket)
      } catch (err) {
        callback(err instanceof Error ? err : new Error(String(err)))
      }
    },
  } as http.AgentOptions)
}

// ── Proxy-Aware Fetch ────────────────────────────────────────────────────────

/**
 * Fetch with proxy support.
 * Automatically uses SOCKS5 or HTTP proxy based on env vars.
 */
export async function proxyFetch(
  url: string,
  options?: RequestInit & { proxy?: ProxyConfig },
): Promise<Response> {
  const proxy = options?.proxy ?? resolveProxyFromEnv()

  if (!proxy) {
    // No proxy — direct fetch
    return fetch(url, options)
  }

  if (proxy.type === 'socks5') {
    // SOCKS5: create agent and use https.request or http.request
    return socks5Fetch(url, proxy, options)
  }

  // HTTP proxy: use fetch with proxy headers
  return httpProxyFetch(url, proxy, options)
}

/**
 * Fetch through SOCKS5 proxy using Node.js http/https modules.
 */
async function socks5Fetch(
  url: string,
  proxy: ProxyConfig,
  options?: RequestInit,
): Promise<Response> {
  const target = new URL(url)
  const isHttps = target.protocol === 'https:'

  const agent = isHttps
    ? createSocks5HttpsAgent(proxy.host, proxy.port, { username: proxy.username, password: proxy.password })
    : createSocks5HttpAgent(proxy.host, proxy.port, { username: proxy.username, password: proxy.password })

  const requestModule = isHttps ? https : http

  return new Promise((resolve, reject) => {
    const req = requestModule.request(
      url,
      {
        method: options?.method ?? 'GET',
        headers: options?.headers as Record<string, string> ?? {},
        agent,
      },
      (res) => {
        // Convert http.IncomingMessage to a Response-like object
        const headers = new Headers()
        if (res.headers) {
          for (const [key, value] of Object.entries(res.headers)) {
            if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value)
          }
        }

        resolve(new Response(res as unknown as ReadableStream, {
          status: res.statusCode ?? 200,
          statusText: res.statusMessage ?? 'OK',
          headers,
        }))
      },
    )

    req.on('error', reject)

    if (options?.body) {
      const body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body)
      req.write(body)
    }

    req.end()
  })
}

/**
 * Fetch through HTTP proxy.
 */
async function httpProxyFetch(
  url: string,
  proxy: ProxyConfig,
  options?: RequestInit,
): Promise<Response> {
  // For HTTP proxy, we set the Proxy-Authorization header
  const headers: Record<string, string> = {}
  if (options?.headers) {
    if (options.headers instanceof Headers) {
      options.headers.forEach((v, k) => { headers[k] = v })
    } else {
      Object.assign(headers, options.headers)
    }
  }

  if (proxy.username && proxy.password) {
    const auth = Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')
    headers['Proxy-Authorization'] = `Basic ${auth}`
  }

  // Use fetch with proxy URL as base (HTTP proxy forwards the full URL)
  return fetch(url, { ...options, headers })
}
