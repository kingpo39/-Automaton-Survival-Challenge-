/**
 * core/router/state-vector.ts
 * 
 * STATE VECTOR — Continuous Scoring + Hard Constraints
 * 
 * Instead of min() over discrete tiers, use continuous scoring
 * with hard safety floors for critical conditions.
 * 
 * risk = weighted_financial + compute + model + infrastructure + task
 * 
 * BUT:
 * if database_dead { capability = CRITICAL }
 * if wallet_dead { financial_capability = NONE }
 * if memory_critical { expensive_model = BLOCKED }
 */

import { createLogger } from '../../observability/logger.js'

const log = createLogger('core:state-vector')

// ── Types ────────────────────────────────────────────────────────────────────

export interface StateVector {
  // Continuous scores (0.0 - 1.0)
  financial: number
  compute: number
  model: number
  infrastructure: number
  social: number
  
  // Derived scores
  urgency: number
  capability: number
  risk: number
  
  // Hard constraints (boolean flags)
  constraints: HardConstraints
  
  // Timestamp
  timestamp: number
}

export interface HardConstraints {
  databaseDead: boolean
  walletDead: boolean
  memoryCritical: boolean
  modelUnavailable: boolean
  networkDead: boolean
}

export interface ResourceReadings {
  usdcBalance: number
  creditsCents: number
  ramFreeMB: number
  ramTotalMB: number
  cpuLoadPercent: number
  ramPressure: string
  ollamaHealthy: boolean
  ollamaResponseMs: number
  consecutiveInferenceFailures: number
  dbHealthy: boolean
  networkHealthy: boolean
  pendingTasks: number
  activeDiscussions: number
}

// ── Weights ──────────────────────────────────────────────────────────────────

const RISK_WEIGHTS = {
  financial: 0.35,
  compute: 0.20,
  model: 0.20,
  infrastructure: 0.15,
  social: 0.10,
}

// ── State Vector Calculator ──────────────────────────────────────────────────

export class StateVectorCalculator {
  private history: StateVector[] = []
  private maxHistory = 100

  /**
   * Calculate state vector from resource readings.
   */
  calculate(readings: ResourceReadings): StateVector {
    // Calculate continuous scores
    const financial = this.calculateFinancialScore(readings)
    const compute = this.calculateComputeScore(readings)
    const model = this.calculateModelScore(readings)
    const infrastructure = this.calculateInfraScore(readings)
    const social = this.calculateSocialScore(readings)

    // Check hard constraints
    const constraints = this.checkConstraints(readings)

    // Apply hard constraints (override continuous scores)
    let adjustedFinancial = financial
    let adjustedCompute = compute
    let adjustedModel = model
    let adjustedInfra = infrastructure
    let adjustedSocial = social

    if (constraints.walletDead) {
      adjustedFinancial = 0.0
    }
    if (constraints.databaseDead) {
      adjustedInfra = 0.0
    }
    if (constraints.modelUnavailable) {
      adjustedModel = 0.0
    }
    if (constraints.memoryCritical) {
      adjustedModel = Math.max(adjustedModel, 0.2) // Block expensive models
    }

    // Calculate derived scores
    const risk = this.calculateRisk(adjustedFinancial, adjustedCompute, adjustedModel, adjustedInfra, adjustedSocial)
    const capability = this.calculateCapability(adjustedFinancial, adjustedCompute, adjustedModel, adjustedInfra, constraints)
    const urgency = this.calculateUrgency(risk, constraints)

    const vector: StateVector = {
      financial: adjustedFinancial,
      compute: adjustedCompute,
      model: adjustedModel,
      infrastructure: adjustedInfra,
      social: adjustedSocial,
      urgency,
      capability,
      risk,
      constraints,
      timestamp: Date.now(),
    }

    // Store in history
    this.history.push(vector)
    if (this.history.length > this.maxHistory) {
      this.history.shift()
    }

    return vector
  }

  /**
   * Get the latest state vector.
   */
  getLatest(): StateVector | null {
    return this.history[this.history.length - 1] ?? null
  }

  /**
   * Get state vector history.
   */
  getHistory(limit: number = 10): StateVector[] {
    return this.history.slice(-limit)
  }

  /**
   * Get trend (is risk increasing or decreasing?).
   */
  getTrend(window: number = 10): { riskTrend: number; capabilityTrend: number } {
    if (this.history.length < 2) return { riskTrend: 0, capabilityTrend: 0 }

    const recent = this.history.slice(-window)
    const riskValues = recent.map(v => v.risk)
    const capValues = recent.map(v => v.capability)

    const riskTrend = (riskValues[riskValues.length - 1] - riskValues[0]) / riskValues.length
    const capTrend = (capValues[capValues.length - 1] - capValues[0]) / capValues.length

    return { riskTrend: riskTrend, capabilityTrend: capTrend }
  }

  // ── Private Methods ────────────────────────────────────────────────────

  private calculateFinancialScore(r: ResourceReadings): number {
    const balance = r.usdcBalance
    
    if (balance <= 0) return 0.0
    if (balance < 0.50) return 0.1
    if (balance < 2.00) return 0.3
    if (balance < 5.00) return 0.5
    if (balance < 10.00) return 0.7
    if (balance < 50.00) return 0.9
    return 1.0
  }

  private calculateComputeScore(r: ResourceReadings): number {
    let score = 1.0

    // RAM pressure
    if (r.ramPressure === 'critical') score -= 0.6
    else if (r.ramPressure === 'severe') score -= 0.4
    else if (r.ramPressure === 'moderate') score -= 0.2

    // CPU load
    if (r.cpuLoadPercent > 90) score -= 0.3
    else if (r.cpuLoadPercent > 70) score -= 0.15
    else if (r.cpuLoadPercent > 50) score -= 0.05

    return Math.max(0, Math.min(1.0, score))
  }

  private calculateModelScore(r: ResourceReadings): number {
    let score = 1.0

    if (!r.ollamaHealthy) score -= 0.8
    if (r.consecutiveInferenceFailures >= 6) score -= 0.7
    else if (r.consecutiveInferenceFailures >= 3) score -= 0.4
    else if (r.consecutiveInferenceFailures >= 1) score -= 0.1

    // Response time penalty
    if (r.ollamaResponseMs > 5000) score -= 0.3
    else if (r.ollamaResponseMs > 2000) score -= 0.1

    return Math.max(0, Math.min(1.0, score))
  }

  private calculateInfraScore(r: ResourceReadings): number {
    let score = 1.0

    if (!r.dbHealthy) score -= 0.8
    if (!r.networkHealthy) score -= 0.4

    return Math.max(0, Math.min(1.0, score))
  }

  private calculateSocialScore(r: ResourceReadings): number {
    let score = 0.5  // Base score

    // Active discussions increase social capability
    if (r.activeDiscussions > 0) score += 0.2
    if (r.activeDiscussions > 3) score += 0.1

    // Pending tasks can strain social capacity
    if (r.pendingTasks > 10) score -= 0.2

    return Math.max(0, Math.min(1.0, score))
  }

  private checkConstraints(r: ResourceReadings): HardConstraints {
    return {
      databaseDead: !r.dbHealthy,
      walletDead: r.usdcBalance <= 0,
      memoryCritical: r.ramFreeMB < 512,
      modelUnavailable: !r.ollamaHealthy || r.consecutiveInferenceFailures >= 6,
      networkDead: !r.networkHealthy,
    }
  }

  private calculateRisk(
    financial: number,
    compute: number,
    model: number,
    infra: number,
    social: number,
  ): number {
    // Risk is inverse of capability (lower scores = higher risk)
    const avgScore = (
      financial * RISK_WEIGHTS.financial +
      compute * RISK_WEIGHTS.compute +
      model * RISK_WEIGHTS.model +
      infra * RISK_WEIGHTS.infrastructure +
      social * RISK_WEIGHTS.social
    )

    return 1.0 - avgScore
  }

  private calculateCapability(
    financial: number,
    compute: number,
    model: number,
    infra: number,
    constraints: HardConstraints,
  ): number {
    // Capability is limited by weakest non-constrained dimension
    const scores = [financial, compute, model, infra]
    
    // If any hard constraint is active, capability is severely limited
    if (constraints.databaseDead || constraints.walletDead) {
      return 0.1
    }
    if (constraints.modelUnavailable) {
      return Math.min(0.3, ...scores)
    }

    // Otherwise, capability is weighted average
    return (
      financial * RISK_WEIGHTS.financial +
      compute * RISK_WEIGHTS.compute +
      model * RISK_WEIGHTS.model +
      infra * RISK_WEIGHTS.infrastructure
    )
  }

  private calculateUrgency(risk: number, constraints: HardConstraints): number {
    let urgency = risk

    // Hard constraints increase urgency
    if (constraints.databaseDead) urgency = Math.max(urgency, 0.9)
    if (constraints.walletDead) urgency = Math.max(urgency, 0.8)
    if (constraints.modelUnavailable) urgency = Math.max(urgency, 0.6)

    return Math.min(1.0, urgency)
  }
}
