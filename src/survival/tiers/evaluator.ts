/**
 * survival/tiers/evaluator.ts
 * 
 * THE DECISION BRAIN.
 * 
 * Core principle: WORST SIGNAL WINS.
 * The recommended tier is only as good as the weakest of the four signal groups.
 * Good USDC never masks bad RAM.
 * Good Ollama never masks a dead database.
 * This conservative posture prevents silent degradation.
 * 
 * Evaluation is pure: (SensorReadings, currentTier, criticalSince) → TierEvaluation.
 * No side effects, no I/O, no LLM. Fast.
 */

import type { SurvivalTier } from '../../types.js'
import type { SensorReadings } from '../sensors/index.js'

const DEAD_GRACE_PERIOD_MS = 60 * 60 * 1_000  // 1 hour

// ── Public types ─────────────────────────────────────────────────────────────

export interface TierEvaluation {
  recommended: SurvivalTier       // final tier after dead-logic applied
  preDead: SurvivalTier           // before dead-logic (used to manage criticalSince)
  reason: string                  // human-readable for logs / agent feedback
  urgency: 'routine' | 'immediate' | 'emergency'

  // Per-signal sub-tiers (for debugging / status output)
  financialTier: SurvivalTier
  computeTier:   SurvivalTier
  modelTier:     SurvivalTier
  infraTier:     SurvivalTier
}

// ── Tier Level Map ──────────────────────────────────────────────────────────

export const TIER_LEVEL: Record<SurvivalTier, number> = {
  high:        4,
  normal:      3,
  low_compute: 2,
  critical:    1,
  dead:        0,
}

// ── TierEvaluator ────────────────────────────────────────────────────────────

export class TierEvaluator {

  evaluate(
    r: SensorReadings,
    currentTier: SurvivalTier,
    criticalSince: number | null,
  ): TierEvaluation {

    // ── 1. Evaluate each signal group independently ──────────────────────
    const financialTier = this.evaluateFinancial(r)
    const computeTier   = this.evaluateCompute(r)
    const modelTier     = this.evaluateModel(r)
    const infraTier     = this.evaluateInfra(r)

    // ── 2. Worst signal wins ─────────────────────────────────────────────
    const preDead = worstTier(financialTier, computeTier, modelTier, infraTier)

    // ── 3. Apply dead-state logic (1 hour grace period) ──────────────────
    const recommended = this.applyDeadLogic(preDead, criticalSince)

    // ── 4. Compute metadata ──────────────────────────────────────────────
    const urgency = this.computeUrgency(recommended, currentTier)
    const reason  = this.buildReason(recommended, financialTier, computeTier, modelTier, infraTier, r)

    return { recommended, preDead, reason, urgency, financialTier, computeTier, modelTier, infraTier }
  }

  // ── Signal evaluators ─────────────────────────────────────────────────────

  /**
   * Financial tier from USDC balance.
   * Does NOT go directly to 'dead' — dead requires grace period (applyDeadLogic).
   */
  private evaluateFinancial(r: SensorReadings): SurvivalTier {
    const b = r.usdcBalance
    if (b >= 50)   return 'high'        // $50+ → full capabilities
    if (b >= 10)   return 'normal'      // $10+ → standard operations
    if (b >= 2)    return 'low_compute' // $2+ → reduce activity
    return 'critical'                    // $0–$2 — still alive, but no outbound spend
  }

  /**
   * Compute tier from RAM and CPU.
   * RAM thresholds tuned for 7.84 GB total with ~5.65 GB baseline consumption.
   */
  private evaluateCompute(r: SensorReadings): SurvivalTier {
    switch (r.ramPressure) {
      case 'critical': return 'critical'    // < 512 MB — cannot safely infer
      case 'severe':   return 'low_compute' // < 1,024 MB — reduce activity
      case 'moderate': return 'low_compute' // < 1,536 MB — be cautious
    }
    // CPU overload guard (less common on 2-core, but thermal throttle can happen)
    if (r.cpuLoadPercent > 90) return 'low_compute'
    return 'normal'
  }

  /**
   * Model tier from Ollama health.
   * Ollama being slow/down → low_compute (not critical) because:
   *   - Heartbeat tasks (deterministic) keep running
   *   - Ollama usually recovers on its own
   *   - Only 6+ consecutive failures upgrade to critical
   */
  private evaluateModel(r: SensorReadings): SurvivalTier {
    if (!r.ollamaHealthy) return 'low_compute'
    if (r.ollamaResponseMs > 5_000) return 'low_compute'   // extremely slow
    if (r.consecutiveInferenceFailures >= 6) return 'critical'
    if (r.consecutiveInferenceFailures >= 3) return 'low_compute'
    return 'normal'
  }

  /**
   * Infra tier from DB and network health.
   * DB failure → critical (we can't persist anything; agent loop must stop).
   * Network failure → low_compute (on-chain reads fail but reasoning still works).
   */
  private evaluateInfra(r: SensorReadings): SurvivalTier {
    if (!r.dbHealthy)      return 'critical'
    if (!r.networkHealthy) return 'low_compute'
    return 'normal'
  }

  // ── Dead logic ────────────────────────────────────────────────────────────

  private applyDeadLogic(preDead: SurvivalTier, criticalSince: number | null): SurvivalTier {
    if (preDead !== 'critical') return preDead
    if (criticalSince !== null && Date.now() - criticalSince >= DEAD_GRACE_PERIOD_MS) {
      return 'dead'
    }
    return 'critical'
  }

  // ── Urgency ───────────────────────────────────────────────────────────────

  private computeUrgency(recommended: SurvivalTier, current: SurvivalTier): TierEvaluation['urgency'] {
    if (recommended === current) return 'routine'
    const drop = TIER_LEVEL[current] - TIER_LEVEL[recommended]
    if (drop >= 2) return 'emergency'   // e.g. high → low_compute (skip a tier)
    return 'immediate'
  }

  // ── Reason builder ────────────────────────────────────────────────────────

  private buildReason(
    tier: SurvivalTier,
    f: SurvivalTier, c: SurvivalTier, m: SurvivalTier, i: SurvivalTier,
    r: SensorReadings,
  ): string {
    const parts: string[] = []

    if (tier === 'dead') {
      parts.push(`Critical for > 1 hour`)
    }

    // Report which signal(s) are driving the recommended tier
    if (f === tier && f !== 'normal' && f !== 'high') {
      parts.push(`USDC $${r.usdcBalance.toFixed(2)}`)
    }
    if (c === tier && c !== 'normal' && c !== 'high') {
      const mb = Math.round(r.ramFreeBytes / 1_048_576)
      parts.push(`RAM ${mb} MB free (${r.ramPressure})`)
      if (r.cpuLoadPercent > 90) parts.push(`CPU ${r.cpuLoadPercent}%`)
    }
    if (m === tier && m !== 'normal' && m !== 'high') {
      if (!r.ollamaHealthy) parts.push('Ollama unreachable')
      else if (r.ollamaResponseMs > 5_000) parts.push(`Ollama slow (${r.ollamaResponseMs}ms)`)
      else if (r.consecutiveInferenceFailures > 0) parts.push(`${r.consecutiveInferenceFailures} inference failures`)
    }
    if (i === tier && i !== 'normal' && i !== 'high') {
      if (!r.dbHealthy)      parts.push('DB write failed')
      if (!r.networkHealthy) parts.push('network unreachable')
    }

    return parts.length > 0 ? parts.join('; ') : `tier=${tier} (no degraded signals)`
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function worstTier(...tiers: SurvivalTier[]): SurvivalTier {
  const min = Math.min(...tiers.map(t => TIER_LEVEL[t]))
  return (Object.entries(TIER_LEVEL).find(([, v]) => v === min)?.[0] ?? 'normal') as SurvivalTier
}
