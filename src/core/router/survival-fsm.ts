/**
 * core/router/survival-fsm.ts
 * 
 * FINITE STATE MACHINE WITH HYSTERESIS
 * 
 * Prevents oscillation between tiers.
 * Enter threshold ≠ exit threshold.
 * 
 * Without hysteresis:
 *   $0.499 → critical
 *   $0.501 → low
 *   $0.499 → critical  (oscillation!)
 * 
 * With hysteresis:
 *   enter CRITICAL  < $0.50
 *   leave CRITICAL  > $0.75  (stable!)
 */

import { createLogger } from '../../observability/logger.js'
import type { SurvivalTier } from '../../types.js'
import { getEventBus } from '../event-bus/index.js'

const log = createLogger('core:survival-fsm')

// ── Types ────────────────────────────────────────────────────────────────────

export interface FSMState {
  current: SurvivalTier
  since: number
  reason: string
  transitions: StateTransition[]
}

export interface StateTransition {
  from: SurvivalTier
  to: SurvivalTier
  timestamp: number
  reason: string
  triggeredBy: string
}

export interface HysteresisThreshold {
  tier: SurvivalTier
  enter: number    // Threshold to ENTER this tier
  exit: number     // Threshold to EXIT this tier (must be higher)
}

// ── Hysteresis Thresholds ────────────────────────────────────────────────────

const HYSTERESIS_THRESHOLDS: HysteresisThreshold[] = [
  { tier: 'dead',        enter: 0,      exit: 0.25 },   // Dead only via grace period, never by balance alone
  { tier: 'critical',    enter: 0.50,   exit: 0.75 },   // Enter at $0.50, leave at $0.75
  { tier: 'low_compute', enter: 2.00,   exit: 3.00 },   // Enter at $2, leave at $3
  { tier: 'normal',      enter: 5.00,   exit: 7.50 },   // Enter at $5, leave at $7.50
  { tier: 'high',        enter: 10.00,  exit: 10.00 },  // Enter at $10, leave at $10 (no hysteresis at top)
]

// ── Survival FSM ─────────────────────────────────────────────────────────────

export class SurvivalFSM {
  private state: FSMState
  private gracePeriodMs = 60 * 60 * 1000  // 1 hour for dead state
  private criticalSince: number | null = null

  constructor(initialTier: SurvivalTier = 'normal') {
    this.state = {
      current: initialTier,
      since: Date.now(),
      reason: 'Initial state',
      transitions: [],
    }
  }

  /**
   * Update FSM based on current resources.
   * Returns the new tier if it changed, null otherwise.
   */
  update(resources: {
    usdcBalance: number
    ramPressure: string
    cpuLoad: number
    ollamaHealthy: boolean
    dbHealthy: boolean
    networkHealthy: boolean
    consecutiveInferenceFailures: number
    opinionMomentum?: number   // -1 to +1 from OpinionEngine (optional)
    opinionConfidence?: number // 0 to 1 (optional, only applies if > 0.5)
  }): SurvivalTier | null {
    const eventBus = getEventBus()

    // Calculate continuous risk scores
    const financialRisk = this.calculateFinancialRisk(resources.usdcBalance)
    const computeRisk = this.calculateComputeRisk(resources.ramPressure, resources.cpuLoad)
    const modelRisk = this.calculateModelRisk(resources.ollamaHealthy, resources.consecutiveInferenceFailures)
    const infraRisk = this.calculateInfraRisk(resources.dbHealthy, resources.networkHealthy)
    const opinionRisk = this.calculateOpinionRisk(
      resources.opinionMomentum ?? 0,
      resources.opinionConfidence ?? 0,
    )

    // HARD SAFETY FLOORS (override continuous scoring)
    if (!resources.dbHealthy) {
      return this.transition('critical', 'Database failure', 'infra')
    }
    if (resources.usdcBalance <= 0) {
      if (this.criticalSince === null) {
        this.criticalSince = Date.now()
        log.warn('Entered critical state — grace period started')
      }
      
      // Check if grace period expired
      if (Date.now() - this.criticalSince >= this.gracePeriodMs) {
        return this.transition('dead', 'Grace period expired', 'financial')
      }
      return this.transition('critical', 'Zero balance', 'financial')
    }

    // Clear critical state if balance recovered
    if (this.criticalSince !== null && resources.usdcBalance > 0.75) {
      this.criticalSince = null
      log.info('Critical state cleared')
    }

    // Determine tier from financial (primary driver with hysteresis)
    const financialTier = this.determineTierFromBalance(resources.usdcBalance)

    // Apply compute/model/infra/opinion constraints
    // Each can force a tier downgrade if its risk is high enough
    let targetTier = financialTier
    if (computeRisk > 0.7) {
      targetTier = this.downgradeTier(targetTier)
    }
    if (modelRisk > 0.8) {
      targetTier = this.downgradeTier(targetTier)
    }
    if (infraRisk > 0.9) {
      targetTier = this.downgradeTier(targetTier)
    }
    // Opinion risk: negative public sentiment degrades capability
    // Only applies with high confidence (>0.5) and strong negativity (<-0.5)
    if (opinionRisk > 0.6) {
      targetTier = this.downgradeTier(targetTier)
      log.info('Opinion risk forced tier downgrade', {
        momentum: resources.opinionMomentum?.toFixed(3),
        confidence: resources.opinionConfidence?.toFixed(2),
        risk: opinionRisk.toFixed(3),
      })
    }

    // Check if tier changed
    if (targetTier !== this.state.current) {
      return this.transition(targetTier, this.buildReason(financialRisk, computeRisk, modelRisk, infraRisk, opinionRisk), 'update')
    }

    return null
  }

  /**
   * Get current state.
   */
  getState(): FSMState {
    return { ...this.state }
  }

  /**
   * Get current tier.
   */
  getCurrentTier(): SurvivalTier {
    return this.state.current
  }

  /**
   * Get time in current state (ms).
   */
  getTimeInState(): number {
    return Date.now() - this.state.since
  }

  /**
   * Get recent transitions.
   */
  getTransitions(limit: number = 10): StateTransition[] {
    return this.state.transitions.slice(-limit)
  }

  /**
   * Force a tier (for testing/manual override).
   */
  force(tier: SurvivalTier, reason: string): void {
    this.transition(tier, reason, 'manual')
  }

  // ── Private Methods ────────────────────────────────────────────────────

  private transition(to: SurvivalTier, reason: string, triggeredBy: string): SurvivalTier {
    const from = this.state.current
    const now = Date.now()

    const transition: StateTransition = {
      from,
      to,
      timestamp: now,
      reason,
      triggeredBy,
    }

    this.state.current = to
    this.state.since = now
    this.state.reason = reason
    this.state.transitions.push(transition)

    // Keep only last 100 transitions
    if (this.state.transitions.length > 100) {
      this.state.transitions = this.state.transitions.slice(-100)
    }

    log.info('Tier transition', { from, to, reason })

    // Emit typed event via singleton bus
    const eventBus = getEventBus()
    eventBus.emit('survival:tier-changed', { from, to, reason, timestamp: Date.now() })

    return to
  }

  private determineTierFromBalance(balance: number): SurvivalTier {
    // Apply hysteresis
    const currentTier = this.state.current
    
    for (const threshold of HYSTERESIS_THRESHOLDS) {
      if (currentTier === threshold.tier) {
        const idx = HYSTERESIS_THRESHOLDS.indexOf(threshold)

        // Check if we should EXIT UP (balance exceeds exit threshold)
        if (balance > threshold.exit) {
          if (idx < HYSTERESIS_THRESHOLDS.length - 1) {
            return HYSTERESIS_THRESHOLDS[idx + 1].tier
          }
          return 'high'
        }

        // Check if we should EXIT DOWN (balance drops below enter threshold)
        // Jump directly to the tier the balance qualifies for (skip dead)
        if (balance < threshold.enter) {
          for (let i = idx - 1; i >= 1; i--) {
            if (balance >= HYSTERESIS_THRESHOLDS[i].enter) {
              return HYSTERESIS_THRESHOLDS[i].tier
            }
          }
          return 'critical'  // Below all non-dead thresholds
        }

        // Balance is within hysteresis band — stay
        return currentTier
      }
    }

    // Determine new tier from balance (first entry, skip dead — dead only via grace period)
    for (let i = HYSTERESIS_THRESHOLDS.length - 1; i >= 1; i--) {
      if (balance >= HYSTERESIS_THRESHOLDS[i].enter) {
        return HYSTERESIS_THRESHOLDS[i].tier
      }
    }

    return 'critical'  // Below all thresholds = critical (dead only via grace period)
  }

  private downgradeTier(tier: SurvivalTier): SurvivalTier {
    const order: SurvivalTier[] = ['high', 'normal', 'low_compute', 'critical', 'dead']
    const idx = order.indexOf(tier)
    return order[Math.min(idx + 1, order.length - 1)]
  }

  private calculateFinancialRisk(balance: number): number {
    if (balance <= 0) return 1.0
    if (balance < 0.50) return 0.9
    if (balance < 2.00) return 0.7
    if (balance < 5.00) return 0.5
    if (balance < 10.00) return 0.3
    return 0.1
  }

  private calculateComputeRisk(ramPressure: string, cpuLoad: number): number {
    let risk = 0
    if (ramPressure === 'critical') risk += 0.6
    else if (ramPressure === 'severe') risk += 0.4
    else if (ramPressure === 'moderate') risk += 0.2
    
    if (cpuLoad > 90) risk += 0.3
    else if (cpuLoad > 70) risk += 0.15
    
    return Math.min(1.0, risk)
  }

  private calculateModelRisk(ollamaHealthy: boolean, failures: number): number {
    if (!ollamaHealthy) return 0.8
    if (failures >= 6) return 0.9
    if (failures >= 3) return 0.5
    if (failures >= 1) return 0.2
    return 0
  }

  private calculateInfraRisk(dbHealthy: boolean, networkHealthy: boolean): number {
    let risk = 0
    if (!dbHealthy) risk += 0.8
    if (!networkHealthy) risk += 0.4
    return Math.min(1.0, risk)
  }

  /**
   * Opinion risk: negative public sentiment degrades operational capability.
   * Only significant when confidence is high (>0.5) and momentum is strongly negative (<-0.3).
   *
   * Maps sentiment to risk:
   *   momentum = -1.0 → risk 1.0 (hostile public)
   *   momentum = -0.5 → risk 0.6 (negative sentiment)
   *   momentum =  0.0 → risk 0.0 (neutral)
   *   momentum = +0.5 → risk 0.0 (positive, no risk)
   */
  private calculateOpinionRisk(momentum: number, confidence: number): number {
    // No risk if confidence is too low (not enough data)
    if (confidence < 0.3) return 0
    // No risk if sentiment is neutral or positive
    if (momentum >= 0) return 0
    // Scale: -1.0 momentum × 1.0 confidence = 1.0 risk
    // Clamp to max 0.8 — opinion alone should never kill the agent
    const raw = Math.abs(momentum) * confidence
    return Math.min(0.8, raw)
  }

  private buildReason(financial: number, compute: number, model: number, infra: number, opinion?: number): string {
    const parts: string[] = []
    if (financial > 0.7) parts.push('financial pressure')
    if (compute > 0.7) parts.push('compute pressure')
    if (model > 0.7) parts.push('model issues')
    if (infra > 0.7) parts.push('infra issues')
    if (opinion !== undefined && opinion > 0.6) parts.push('negative public sentiment')
    return parts.join(', ') || 'resource change'
  }
}
