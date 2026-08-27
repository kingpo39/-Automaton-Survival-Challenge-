/**
 * survival/moderator.ts
 * 
 * THE MODERATOR SNIFFER — Like Wireshark for Agent Survival.
 * 
 * Captures ALL signals from every source in the system:
 * - Financial (USDC, credits, spending)
 * - Compute (RAM, CPU, disk)
 * - Model (Ollama health, inference failures)
 * - Infrastructure (DB, network)
 * - Social (inbox, children, distress)
 * - Discussions (multi-agent summaries, moderator reads)
 * - Alerts (policy violations, tier changes)
 * 
 * Core principle: CATCH EVERYTHING, FILTER NOTHING.
 * Like Wireshark captures every packet, the sniffer captures every signal.
 * Analysis happens later — capture first, judge never.
 */

import { createLogger } from '../observability/logger.js'
import type { AutomatonDatabase, SurvivalTier, Alert, TurnRecord, WorkingMemoryRecord, EpisodicMemoryRecord } from '../types.js'

const log = createLogger('survival:moderator')

// ── Helpers ──────────────────────────────────────────────────────────────────

function safeParseInt(val: string | undefined | null, fallback = 0): number {
  if (val == null || val === '') return fallback
  const n = parseInt(val, 10)
  return isFinite(n) ? n : fallback
}

function safeParseFloat(val: string | undefined | null, fallback = 0): number {
  if (val == null || val === '') return fallback
  const n = parseFloat(val)
  return isFinite(n) ? n : fallback
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface SnifferSnapshot {
  timestamp: number
  currentTier: SurvivalTier
  threatScore: number           // 0-100, higher = more threatened
  recommendedAction: string

  financial: FinancialSignals
  compute: ComputeSignals
  model: ModelSignals
  infra: InfraSignals
  social: SocialSignals
  discussions: DiscussionSignal[]
  alerts: AlertSignal[]
}

export interface FinancialSignals {
  usdcBalance: number
  creditsCents: number
  hourlySpendCents: number
  dailySpendCents: number
  perPaymentCapCents: number
  treasuryReserveCents: number
}

export interface ComputeSignals {
  ramFreeMB: number
  ramTotalMB: number
  cpuLoadPercent: number
  ramPressure: string
}

export interface ModelSignals {
  ollamaHealthy: boolean
  ollamaResponseMs: number
  consecutiveInferenceFailures: number
  currentModel: string
}

export interface InfraSignals {
  dbHealthy: boolean
  networkHealthy: boolean
  lastHeartbeatMs: number
  heartbeatCount: number
}

export interface SocialSignals {
  pendingInboxMessages: number
  activeChildren: number
  distressActive: boolean
  lastSocialMessageMs: number
}

export interface DiscussionSignal {
  source: string
  timestamp: number
  summary: string
  sentiment: 'positive' | 'negative' | 'neutral'
  threatLevel: number
}

export interface AlertSignal {
  severity: 'info' | 'warning' | 'critical'
  message: string
  timestamp: number
  source: string
}

// ── ModeratorSniffer ─────────────────────────────────────────────────────────

export class ModeratorSniffer {
  private lastSnapshot: SnifferSnapshot | null = null

  constructor(
    private readonly db: AutomatonDatabase,
  ) {}

  /**
   * Capture a complete signal snapshot.
   * Reads everything from DB, system, and cached state.
   * No I/O blocking, no LLM — pure data capture.
   */
  capture(): SnifferSnapshot {
    const now = Date.now()

    const financial = this.captureFinancial()
    const compute = this.captureCompute()
    const model = this.captureModel()
    const infra = this.captureInfra()
    const social = this.captureSocial()
    const discussions = this.captureDiscussions()
    const alerts = this.captureAlerts()

    const currentTier = this.getCurrentTier()
    const threatScore = this.computeThreatScore(financial, compute, model, infra)
    const recommendedAction = this.recommendAction(threatScore, currentTier)

    const snapshot: SnifferSnapshot = {
      timestamp: now,
      currentTier,
      threatScore,
      recommendedAction,
      financial,
      compute,
      model,
      infra,
      social,
      discussions,
      alerts,
    }

    this.lastSnapshot = snapshot
    return snapshot
  }

  /**
   * Get the last captured snapshot (no re-capture).
   */
  getLastSnapshot(): SnifferSnapshot | null {
    return this.lastSnapshot
  }

  // ── Capture Methods ─────────────────────────────────────────────────────

  private captureFinancial(): FinancialSignals {
    const usdcBalance = safeParseFloat(this.db.getKV('last_usdc_balance'))
    const creditsCents = safeParseInt(this.db.getKV('last_credits_balance'))
    
    // Get spending from recent turns
    const recentTurns = this.db.getRecentTurns(20)
    const now = Date.now()
    const oneHourAgo = now - 60 * 60 * 1000
    const oneDayAgo = now - 24 * 60 * 60 * 1000
    
    const hourlySpendCents = recentTurns
      .filter((t: TurnRecord) => t.timestamp > oneHourAgo)
      .reduce((sum: number, t: TurnRecord) => sum + t.costCents, 0)
    
    const dailySpendCents = recentTurns
      .filter((t: TurnRecord) => t.timestamp > oneDayAgo)
      .reduce((sum: number, t: TurnRecord) => sum + t.costCents, 0)

    return {
      usdcBalance,
      creditsCents,
      hourlySpendCents,
      dailySpendCents,
      perPaymentCapCents: safeParseInt(this.db.getKV('treasury.perPaymentCap'), 10000),
      treasuryReserveCents: safeParseInt(this.db.getKV('treasury.minimumReserve'), 100),
    }
  }

  private captureCompute(): ComputeSignals {
    try {
      const { freemem, totalmem, loadavg, cpus } = require('os') as typeof import('os')
      const totalMB = Math.round(totalmem() / (1024 * 1024))
      const freeMB = Math.round(freemem() / (1024 * 1024))
      const load1m = loadavg()[0]
      const cpuCount = cpus().length
      const cpuPercent = Math.min(100, Math.round((load1m / cpuCount) * 100))

      let pressure = 'normal'
      if (freeMB < 512) pressure = 'critical'
      else if (freeMB < 1024) pressure = 'severe'
      else if (freeMB < 1536) pressure = 'moderate'

      return {
        ramFreeMB: freeMB,
        ramTotalMB: totalMB,
        cpuLoadPercent: cpuPercent,
        ramPressure: pressure,
      }
    } catch {
      return { ramFreeMB: 0, ramTotalMB: 0, cpuLoadPercent: 100, ramPressure: 'critical' }
    }
  }

  private captureModel(): ModelSignals {
    const ollamaHealthy = this.db.getKV('model.ollama.healthy') === 'true'
    const ollamaResponseMs = safeParseInt(this.db.getKV('model.ollama.responseMs'))
    const consecutiveInferenceFailures = safeParseInt(this.db.getKV('model.inference.failures'))
    const currentModel = this.db.getKV('model.current') ?? 'unknown'

    return { ollamaHealthy, ollamaResponseMs, consecutiveInferenceFailures, currentModel }
  }

  private captureInfra(): InfraSignals {
    let dbHealthy = true
    try {
      const key = `sniffer_check_${Date.now()}`
      this.db.setKV(key, 'ping')
      dbHealthy = this.db.getKV(key) === 'ping'
      this.db.deleteKV(key)
    } catch {
      dbHealthy = false
    }

    const lastHeartbeatMs = safeParseInt(this.db.getKV('heartbeat.lastPing'))
    const heartbeatCount = safeParseInt(this.db.getKV('heartbeat.totalPings'))

    // Network check is cached by sensor layer
    const networkHealthy = this.db.getKV('infra.network.healthy') !== 'false'

    return { dbHealthy, networkHealthy, lastHeartbeatMs, heartbeatCount }
  }

  private captureSocial(): SocialSignals {
    // Count pending inbox messages
    const pendingInboxMessages = this.db.getUnprocessedInboxMessages().length
    
    // Count active children
    const activeChildren = this.db.listChildren().filter((c: { state: string }) => c.state === 'alive').length
    
    // Check distress status
    const distressActive = this.db.getKV('survival.distress.active') === 'true'
    const lastSocialMessageMs = safeParseInt(this.db.getKV('social.lastMessageMs'))

    return { pendingInboxMessages, activeChildren, distressActive, lastSocialMessageMs }
  }

  private captureDiscussions(): DiscussionSignal[] {
    // Read moderator summaries from multi-agent discussions
    const discussions: DiscussionSignal[] = []
    
    // Check for recent discussion summaries in working memory
    const workingMemory = this.db.getWorkingMemory()
    for (const entry of workingMemory) {
      if (entry.category === 'discussion' || entry.category === 'moderator') {
        discussions.push({
          source: entry.key,
          timestamp: entry.createdAt,
          summary: entry.value,
          sentiment: this.analyzeSentiment(entry.value),
          threatLevel: this.computeDiscussionThreat(entry.value),
        })
      }
    }

    // Check for recent episodic events that are discussion-related
    const recentEpisodes = this.db.getEpisodicMemory(20)
    for (const episode of recentEpisodes) {
      if (episode.classification === 'discussion' || episode.classification === 'multi_agent') {
        discussions.push({
          source: 'episodic',
          timestamp: episode.timestamp,
          summary: episode.event,
          sentiment: this.analyzeSentiment(episode.event),
          threatLevel: this.computeDiscussionThreat(episode.event),
        })
      }
    }

    // Sort by timestamp, most recent first
    return discussions.sort((a, b) => b.timestamp - a.timestamp)
  }

  private captureAlerts(): AlertSignal[] {
    const alerts: AlertSignal[] = []
    
    // Check tier change alerts
    const tierReason = this.db.getKV('survival.tier_reason')
    if (tierReason) {
      const tierSince = safeParseInt(this.db.getKV('survival.tier_since'))
      const tier = this.db.getKV('survival.tier') as SurvivalTier
      if (tier === 'critical' || tier === 'dead') {
        alerts.push({
          severity: tier === 'dead' ? 'critical' : 'warning',
          message: `Tier ${tier}: ${tierReason}`,
          timestamp: tierSince,
          source: 'survival:brain',
        })
      }
    }

    // Check recent policy decisions (denied actions)
    const recentTurns = this.db.getRecentTurns(5)
    for (const turn of recentTurns) {
      if (turn.state === 'critical' || turn.state === 'dead') {
        alerts.push({
          severity: 'warning',
          message: `Agent state: ${turn.state}`,
          timestamp: turn.timestamp,
          source: 'agent:loop',
        })
      }
    }

    return alerts.sort((a, b) => b.timestamp - a.timestamp)
  }

  // ── Analysis Methods ────────────────────────────────────────────────────

  private getCurrentTier(): SurvivalTier {
    return (this.db.getKV('survival.tier') as SurvivalTier) ?? 'normal'
  }

  private computeThreatScore(
    financial: FinancialSignals,
    compute: ComputeSignals,
    model: ModelSignals,
    infra: InfraSignals,
  ): number {
    let score = 0

    // Financial threat (0-30)
    if (financial.usdcBalance < 2) score += 30
    else if (financial.usdcBalance < 10) score += 15
    else if (financial.usdcBalance < 50) score += 5

    // Compute threat (0-25)
    if (compute.ramPressure === 'critical') score += 25
    else if (compute.ramPressure === 'severe') score += 15
    else if (compute.ramPressure === 'moderate') score += 8

    if (compute.cpuLoadPercent > 90) score += 10
    else if (compute.cpuLoadPercent > 70) score += 5

    // Model threat (0-25)
    if (!model.ollamaHealthy) score += 15
    if (model.consecutiveInferenceFailures >= 6) score += 25
    else if (model.consecutiveInferenceFailures >= 3) score += 10

    // Infra threat (0-20)
    if (!infra.dbHealthy) score += 20
    if (!infra.networkHealthy) score += 10

    return Math.min(100, score)
  }

  private recommendAction(threatScore: number, tier: SurvivalTier): string {
    if (tier === 'dead') return 'EMERGENCY: Await funding, broadcast distress'
    if (tier === 'critical') return 'CRITICAL: Minimal operations, request funding'
    if (threatScore >= 70) return 'HIGH THREAT: Reduce activity, monitor closely'
    if (threatScore >= 40) return 'ELEVATED: Monitor resources, prepare fallbacks'
    if (threatScore >= 20) return 'NORMAL: Continue operations'
    return 'ALL CLEAR: Full capabilities available'
  }

  private analyzeSentiment(text: string): 'positive' | 'negative' | 'neutral' {
    const lower = text.toLowerCase()
    const negativeWords = ['threat', 'danger', 'risk', 'warning', 'critical', 'fail', 'error', 'attack']
    const positiveWords = ['success', 'opportunity', 'growth', 'healthy', 'stable', 'improve']
    
    const negCount = negativeWords.filter(w => lower.includes(w)).length
    const posCount = positiveWords.filter(w => lower.includes(w)).length
    
    if (negCount > posCount) return 'negative'
    if (posCount > negCount) return 'positive'
    return 'neutral'
  }

  private computeDiscussionThreat(text: string): number {
    const lower = text.toLowerCase()
    let threat = 0
    
    if (lower.includes('attack')) threat += 30
    if (lower.includes('exploit')) threat += 25
    if (lower.includes('vulnerability')) threat += 20
    if (lower.includes('compromise')) threat += 25
    if (lower.includes('malicious')) threat += 20
    if (lower.includes('injection')) threat += 15
    if (lower.includes('denial')) threat += 15
    
    return Math.min(100, threat)
  }
}
