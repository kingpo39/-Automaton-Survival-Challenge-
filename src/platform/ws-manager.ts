/**
 * platform/ws-manager.ts
 *
 * WebSocket connection manager for the social relay.
 * Tracks connection state, reconnection attempts, and message timestamps.
 *
 * Used by ConnectionHealthMonitor to know whether WS is up
 * (so it can adjust HTTP poll frequency accordingly).
 */

import { EventEmitter } from 'node:events'
import { createLogger } from '../observability/logger.js'

const log = createLogger('platform:ws-manager')

// ── Types ────────────────────────────────────────────────────────────────

export type WSState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

export interface WSConfig {
  url: string                    // e.g. 'wss://relay.conway.tech/ws'
  apiKey?: string
  reconnectBaseMs?: number       // initial reconnect delay (default: 1000)
  reconnectMaxMs?: number        // max reconnect delay (default: 30_000)
  heartbeatMs?: number           // ping interval (default: 15_000)
  timeoutMs?: number             // connection timeout (default: 10_000)
}

export interface WSStats {
  state:              WSState
  connectedSinceMs:   number | null  // timestamp of last connect
  reconnectAttempts:  number
  lastMessageMs:      number | null  // timestamp of last inbound message
  lastErrorMs:        number | null
  lastError:          string | null
  totalMessages:      number
  totalReconnects:    number
}

// ── WSManager ────────────────────────────────────────────────────────────

export class WSManager extends EventEmitter {
  private state: WSState = 'disconnected'
  private ws: any = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null

  private connectedSinceMs: number | null = null
  private reconnectAttempts = 0
  private lastMessageMs: number | null = null
  private lastErrorMs: number | null = null
  private lastError: string | null = null
  private totalMessages = 0
  private totalReconnects = 0

  private readonly cfg: Required<WSConfig>

  constructor(config: WSConfig) {
    super()
    this.cfg = {
      url:             config.url,
      apiKey:          config.apiKey          ?? '',
      reconnectBaseMs: config.reconnectBaseMs ?? 1_000,
      reconnectMaxMs:  config.reconnectMaxMs  ?? 30_000,
      heartbeatMs:     config.heartbeatMs     ?? 15_000,
      timeoutMs:       config.timeoutMs       ?? 10_000,
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────

  getState(): WSState {
    return this.state
  }

  getStats(): WSStats {
    return {
      state:             this.state,
      connectedSinceMs:  this.connectedSinceMs,
      reconnectAttempts: this.reconnectAttempts,
      lastMessageMs:     this.lastMessageMs,
      lastErrorMs:       this.lastErrorMs,
      lastError:         this.lastError,
      totalMessages:     this.totalMessages,
      totalReconnects:   this.totalReconnects,
    }
  }

  async connect(): Promise<void> {
    if (this.state === 'connected' || this.state === 'connecting') return

    this.setState('connecting')
    try {
      // Dynamic import — ws is optional (may not be installed)
      const wsModule: any = await import('ws')
      const WS: any = wsModule.default || wsModule.WebSocket || wsModule
      const headers: Record<string, string> = { 'User-Agent': 'automaton-relay/1.0' }
      if (this.cfg.apiKey) headers['Authorization'] = `Bearer ${this.cfg.apiKey}`

      this.ws = new WS(this.cfg.url, { headers, handshakeTimeout: this.cfg.timeoutMs })

      this.ws.on('open', () => {
        this.setState('connected')
        this.connectedSinceMs = Date.now()
        this.reconnectAttempts = 0
        this.lastError = null
        log.info('websocket connected', { url: this.cfg.url })
        this.emit('connected')
        this.startHeartbeat()
      })

      this.ws.on('message', (raw: Buffer) => {
        this.lastMessageMs = Date.now()
        this.totalMessages++
        try {
          const msg = JSON.parse(raw.toString())
          this.emit('message', msg)
        } catch {
          // Non-JSON message — ignore
        }
      })

      this.ws.on('close', (code: number, reason: Buffer) => {
        this.setState('disconnected')
        this.connectedSinceMs = null
        this.stopHeartbeat()
        const msg = `close ${code}: ${reason.toString()}`
        this.lastError = msg
        this.lastErrorMs = Date.now()
        log.warn('websocket closed', { code, reason: reason.toString() })
        this.emit('disconnected', { code, reason: msg })
        this.scheduleReconnect()
      })

      this.ws.on('error', (err: Error) => {
        this.lastError = err.message
        this.lastErrorMs = Date.now()
        log.error('websocket error', { error: err.message })
        this.emit('error', err)
      })

      // Connection timeout
      const timeout = setTimeout(() => {
        if (this.state === 'connecting' && this.ws) {
          this.ws.close(4000, 'timeout')
          this.lastError = 'connection timeout'
          this.lastErrorMs = Date.now()
          this.scheduleReconnect()
        }
      }, this.cfg.timeoutMs)

      this.ws.once('open', () => clearTimeout(timeout))
      this.ws.once('error', () => clearTimeout(timeout))
    } catch (err: any) {
      this.lastError = err.message
      this.lastErrorMs = Date.now()
      this.setState('disconnected')
      log.error('websocket connect failed', { error: err.message })
      this.scheduleReconnect()
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.stopHeartbeat()
    this.reconnectAttempts = 0 // manual disconnect resets counter
    if (this.ws) {
      this.ws.close(1000, 'manual')
      this.ws = null
    }
    this.setState('disconnected')
    this.connectedSinceMs = null
    log.info('websocket disconnected (manual)')
  }

  send(data: unknown): boolean {
    if (this.state !== 'connected' || !this.ws) return false
    try {
      this.ws.send(JSON.stringify(data))
      return true
    } catch (err: any) {
      this.lastError = err.message
      this.lastErrorMs = Date.now()
      log.error('websocket send failed', { error: err.message })
      return false
    }
  }

  /**
   * Get recommended HTTP poll interval based on WS state.
   * When WS is connected, HTTP polling is redundant — slow is fine.
   * When WS is down, HTTP polling is the lifeline — poll fast.
   */
  getHttpPollRecommendation(): { shouldPoll: boolean; intervalMs: number; reason: string } {
    const wsUp = this.state === 'connected'
    const silenceMs = this.lastMessageMs ? Date.now() - this.lastMessageMs : Infinity

    // If WS connected but no messages for >2× heartbeat, it might be a zombie
    const zombie = wsUp && silenceMs > this.cfg.heartbeatMs * 2

    if (zombie) {
      return { shouldPoll: true, intervalMs: 30_000, reason: 'WS zombie detected' }
    }
    if (wsUp) {
      return { shouldPoll: false, intervalMs: 5 * 60_000, reason: 'WS healthy' }
    }
    return { shouldPoll: true, intervalMs: 60_000, reason: 'WS offline' }
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private setState(s: WSState) {
    if (this.state === s) return
    const prev = this.state
    this.state = s
    this.emit('stateChange', { from: prev, to: s })
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return // already scheduled
    this.setState('reconnecting')
    this.reconnectAttempts++
    this.totalReconnects++

    // Exponential backoff with jitter
    const base = this.cfg.reconnectBaseMs
    const delay = Math.min(
      base * Math.pow(2, this.reconnectAttempts - 1),
      this.cfg.reconnectMaxMs
    )
    const jitter = Math.random() * delay * 0.3
    const waitMs = Math.round(delay + jitter)

    log.info('scheduling reconnect', { attempt: this.reconnectAttempts, waitMs })
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, waitMs)
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (this.state === 'connected' && this.ws) {
        try { this.ws.ping() } catch { /* ignore */ }
      }
    }, this.cfg.heartbeatMs)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }
}
