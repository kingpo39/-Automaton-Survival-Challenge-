/**
 * platform/connection-health.ts
 *
 * Dual-path connection health monitor.
 *
 * The survival agent uses TWO communication paths to the social relay:
 *   1. WebSocket (primary) — fast, real-time, can disconnect
 *   2. HTTP polling (fallback) — slow, always works, never "disconnects"
 *
 * This module makes the HTTP polling path SMARTER:
 *   - Increases poll frequency when WS is offline (so nothing is missed)
 *   - Decreases poll frequency when WS is healthy (no need for redundant requests)
 *   - Always polls more aggressively during critical/dead states
 *     (those are the moments when a USDC inbound transfer matters most)
 *
 * The heartbeat task 'check_social_inbox' calls this module to get its
 * target interval instead of using a fixed cron expression.
 *
 * This is the GUARANTEED channel. Even if WebSocket is completely broken,
 * the agent will still receive funding alerts and social messages
 * within MAX_POLL_INTERVAL_MS.
 */

import type { WSState } from './ws-manager.js'
import type { SurvivalTier } from '../types.js'
import { createLogger } from '../observability/logger.js'

const log = createLogger('platform:connection-health')

// ── Types ────────────────────────────────────────────────────────────────

export interface ConnectionStatus {
  wsState:            WSState
  wsConnectedMs:      number        // how long WS has been connected; 0 if not
  httpPollIntervalMs: number        // recommended poll interval right now
  lastHttpPollMs:     number        // ms since last HTTP poll
  lastMessageMs:      number        // ms since last message received (any channel)
  overallHealthy:     boolean
  channel:            'websocket' | 'http_polling' | 'both' | 'none'
}

// ── Poll Intervals ───────────────────────────────────────────────────────
//
// Logic: poll more when (a) WS is down, (b) tier is low, or both.
//   high/normal + WS up   → 5 min  (WS handles real-time; HTTP is idle backup)
//   high/normal + WS down → 2 min  (catch-up mode)
//   low_compute + WS up   → 2 min
//   low_compute + WS down → 1 min
//   critical + WS up      → 1 min  (USDC alerts are time-critical)
//   critical + WS down    → 30 sec (maximum alertness without burn)
//   dead                   → 60 sec (WS is off; just enough to detect funding)

const POLL_INTERVALS: Record<SurvivalTier, { wsUp: number; wsDown: number }> = {
  high:        { wsUp: 5 * 60_000, wsDown: 2 * 60_000 },
  normal:      { wsUp: 5 * 60_000, wsDown: 2 * 60_000 },
  low_compute: { wsUp: 2 * 60_000, wsDown: 1 * 60_000 },
  critical:    { wsUp: 1 * 60_000, wsDown: 30_000 },
  dead:        { wsUp: 60_000,     wsDown: 60_000 },
}

/** Absolute maximum: even in worst case, never poll faster than this. */
const MIN_POLL_INTERVAL_MS = 15_000

/** Absolute minimum: even if things are healthy, always check within this window. */
const MAX_POLL_INTERVAL_MS = 10 * 60_000

// ── ConnectionHealthMonitor ──────────────────────────────────────────────

export class ConnectionHealthMonitor {
  private wsConnectedSince: number | null = null
  private lastHttpPoll = 0
  private lastMessage  = 0

  constructor(
    private readonly wsManager: { getState: () => WSState },
    private readonly getSurvivalTier: () => SurvivalTier,
  ) {}

  // ── Event hooks (called by the agent loop) ──────────────────────────────

  onWSConnected(): void     { this.wsConnectedSince = Date.now() }
  onWSDisconnected(): void  { this.wsConnectedSince = null }
  onMessageReceived(): void { this.lastMessage = Date.now() }
  onHttpPollCompleted(): void { this.lastHttpPoll = Date.now() }

  // ── Decision methods ────────────────────────────────────────────────────

  /**
   * Called by the heartbeat scheduler before running 'check_social_inbox'.
   * Returns true if it's time to poll (the task is due).
   */
  shouldPollNow(): boolean {
    const interval = this.getRecommendedPollIntervalMs()
    return Date.now() - this.lastHttpPoll >= interval
  }

  /**
   * The poll interval the heartbeat task should use.
   * Replaces the fixed cron expression for check_social_inbox.
   */
  getRecommendedPollIntervalMs(): number {
    const tier    = this.getSurvivalTier()
    const wsState = this.wsManager.getState()
    const wsUp    = wsState === 'connected'

    const intervals = POLL_INTERVALS[tier]
    const raw = wsUp ? intervals.wsUp : intervals.wsDown

    // Clamp to global bounds
    return Math.max(MIN_POLL_INTERVAL_MS, Math.min(MAX_POLL_INTERVAL_MS, raw))
  }

  /**
   * Should we skip this poll because WS already delivered the message?
   * Returns false if WS is connected AND last message was recent.
   */
  shouldBypassHttpPoll(): boolean {
    const wsUp = this.wsManager.getState() === 'connected'
    const msgAge = this.lastMessage > 0 ? Date.now() - this.lastMessage : Infinity
    const interval = this.getRecommendedPollIntervalMs()

    // Skip HTTP poll if WS is healthy and delivered a message within the poll window
    return wsUp && msgAge < interval
  }

  /**
   * Human-readable status string for debugging / status output.
   */
  getStatusSummary(): string {
    const s = this.getStatus()
    const channelEmoji = { websocket: '🔌', http_polling: '📡', both: '🔗', none: '❌' }
    return `${channelEmoji[s.channel]} ${s.channel} | tier poll: ${(s.httpPollIntervalMs / 1000).toFixed(0)}s | ws: ${s.wsState}${s.wsConnectedMs > 0 ? ' (' + formatDuration(s.wsConnectedMs) + ')' : ''}`
  }

  // ── Full status ─────────────────────────────────────────────────────────

  getStatus(): ConnectionStatus {
    const wsState = this.wsManager.getState()
    const tier    = this.getSurvivalTier()
    const wsUp    = wsState === 'connected'

    const wsConnectedMs      = this.wsConnectedSince ? Date.now() - this.wsConnectedSince : 0
    const httpPollIntervalMs = this.getRecommendedPollIntervalMs()
    const lastHttpPollMs     = this.lastHttpPoll > 0 ? Date.now() - this.lastHttpPoll : Infinity
    const lastMessageMs      = this.lastMessage  > 0 ? Date.now() - this.lastMessage  : Infinity

    // Determine active channel(s)
    const channel: ConnectionStatus['channel'] =
      wsUp && lastHttpPollMs < httpPollIntervalMs * 2 ? 'both' :
      wsUp    ? 'websocket' :
      lastHttpPollMs < httpPollIntervalMs * 2 ? 'http_polling' :
      'none'

    const overallHealthy = channel !== 'none'

    if (!overallHealthy) {
      log.warn('no communication channel active', { wsState, lastHttpPollMs, tier })
    }

    return {
      wsState,
      wsConnectedMs,
      httpPollIntervalMs,
      lastHttpPollMs,
      lastMessageMs,
      overallHealthy,
      channel,
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return `${h}h ${m}m`
}
