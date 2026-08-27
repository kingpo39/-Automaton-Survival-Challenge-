/**
 * core/forecast/index.ts
 *
 * Resource exhaustion prediction.
 *
 * Transforms the agent from REACTIVE to PROACTIVE:
 *
 *   REACTIVE (current):
 *     "USDC balance is $1.80. Entering low_compute."   ← already a problem
 *
 *   PROACTIVE (with forecast):
 *     "At current burn rate ($0.80/day), USDC hits low_compute in 10 days.
 *      Recommend reducing x402 spend or requesting funding."   ← time to act
 *
 * Uses signal history from PacketCapture to compute:
 *   1. Financial: linear regression on balance over time → burn rate → days-to-threshold
 *   2. Compute:   moving average of RAM free → trend → predicted pressure onset
 *
 * Output is injected into the system prompt's financial state block,
 * giving the agent forward-looking context without requiring an inference call
 * (all math is deterministic).
 */

import { createLogger } from '../../observability/logger.js'

const log = createLogger('core:forecast')

// ── Types ────────────────────────────────────────────────────────────────

export interface ResourceForecast {
  // ── Financial ──────────────────────────────────────────────────────────
  currentBalance:          number
  dailyBurnRate:           number
  daysUntilLowCompute:     number
  daysUntilCritical:       number
  daysUntilDead:           number
  financialTrajectory:     FinancialTrajectory
  financialConfidence:     number

  // ── Compute ────────────────────────────────────────────────────────────
  currentRamFreeMB:        number
  ramTrend:                RamTrend
  predictedSevereInHours:  number | null
  computeConfidence:       number

  // ── Signal correlations ────────────────────────────────────────────────
  correlations:            SignalCorrelation[]

  // ── Summary ────────────────────────────────────────────────────────────
  summary:                 string
  recommendations:         string[]
  basedOnNReadings:        number
  forecastTimestamp:       number
}

export type FinancialTrajectory = 'stable' | 'recovering' | 'depleting_slowly' | 'depleting_fast' | 'critical_soon'
export type RamTrend             = 'stable' | 'improving' | 'degrading_slowly' | 'degrading_fast'

export interface SignalCorrelation {
  signal1:     string
  signal2:     string
  description: string
  strength:    number
}

// Survival tier USDC thresholds
const THRESHOLDS = {
  high:        50.0,
  normal:      10.0,
  low_compute: 2.0,
  critical:    0.01,
}

// ── ResourceForecaster ───────────────────────────────────────────────────

export class ResourceForecaster {
  private history: Array<{
    ts: number
    usdcBalance: number
    ramFreeMB: number
    ollamaResponseMs: number
  }> = []
  private maxHistory = 2000

  /**
   * Record a resource snapshot (backward-compatible).
   */
  record(snapshot: {
    timestamp: number
    usdcBalance: number
    creditsCents?: number
    spendingRateCentsPerHour?: number
    incomeRateCentsPerHour?: number
    computeRateMBPerHour?: number
    ramFreeMB?: number
    ollamaResponseMs?: number
  }): void {
    this.history.push({
      ts: snapshot.timestamp,
      usdcBalance: snapshot.usdcBalance,
      ramFreeMB: snapshot.ramFreeMB ?? (8 * 1024),  // default 8GB
      ollamaResponseMs: snapshot.ollamaResponseMs ?? 0,
    })
    if (this.history.length > this.maxHistory) {
      this.history.shift()
    }
  }

  /**
   * Generate a forecast from the history.
   */
  forecast(): ResourceForecast {
    if (this.history.length === 0) {
      return this.emptyForecast()
    }

    const sorted    = [...this.history].sort((a, b) => a.ts - b.ts)
    const latest    = sorted[sorted.length - 1]
    const financial = this.forecastFinancial(sorted)
    const compute   = this.forecastCompute(sorted)
    const corrs     = this.detectCorrelations(sorted)

    const summary = this.buildSummary(financial, compute, latest.usdcBalance)
    const recs    = this.buildRecommendations(financial, compute)

    return {
      currentBalance:      latest.usdcBalance,
      dailyBurnRate:       financial.burnRate,
      daysUntilLowCompute: financial.daysToThreshold(THRESHOLDS.low_compute),
      daysUntilCritical:   financial.daysToThreshold(THRESHOLDS.critical),
      daysUntilDead:       financial.daysToThreshold(0),
      financialTrajectory: financial.trajectory,
      financialConfidence: financial.confidence,

      currentRamFreeMB:       latest.ramFreeMB,
      ramTrend:               compute.trend,
      predictedSevereInHours: compute.hoursUntilSevere,
      computeConfidence:      compute.confidence,

      correlations:   corrs,
      summary,
      recommendations: recs,
      basedOnNReadings: sorted.length,
      forecastTimestamp: Date.now(),
    }
  }

  /**
   * Legacy API: forecast USDC runway.
   */
  forecastUSDC(): {
    timestamp: number
    resource: string
    currentValue: number
    runwayHours: number
    recommendations: string[]
    [key: string]: unknown
  } {
    const f = this.forecast()
    return {
      timestamp: f.forecastTimestamp,
      resource: 'usdc',
      currentValue: f.currentBalance,
      runwayHours: f.daysUntilDead * 24,
      recommendations: f.basedOnNReadings === 0
        ? ['Insufficient data for forecast']
        : f.recommendations.length > 0
          ? f.recommendations
          : [`USDC runway: ${(f.daysUntilDead * 24).toFixed(1)} hours`],
    }
  }

  /**
   * Legacy API: get spending trends.
   */
  getSpendingTrends(): {
    current: number
    trend: 'increasing' | 'decreasing' | 'stable'
    changePercent: number
  } {
    if (this.history.length < 2) {
      return { current: 0, trend: 'stable', changePercent: 0 }
    }

    const sorted = [...this.history].sort((a, b) => a.ts - b.ts)
    const now = Date.now()
    const cutoff6h = now - 6 * 3600_000
    const recent = sorted.filter(r => r.ts >= cutoff6h)

    if (recent.length < 2) {
      return { current: 0, trend: 'stable', changePercent: 0 }
    }

    // Calculate spending rate (USDC decrease per hour)
    const rates: number[] = []
    for (let i = 1; i < recent.length; i++) {
      const dt = (recent[i].ts - recent[i - 1].ts) / 3_600_000
      if (dt > 0) {
        rates.push(Math.max(0, (recent[i - 1].usdcBalance - recent[i].usdcBalance) / dt))
      }
    }

    if (rates.length === 0) {
      return { current: 0, trend: 'stable', changePercent: 0 }
    }

    const current = rates[rates.length - 1]
    const midpoint = Math.floor(rates.length / 2)
    const firstHalf = rates.slice(0, midpoint)
    const secondHalf = rates.slice(midpoint)
    const avg1 = firstHalf.length > 0 ? firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length : 0
    const avg2 = secondHalf.length > 0 ? secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length : 0

    const changePercent = avg1 > 0 ? ((avg2 - avg1) / avg1) * 100 : 0
    const trend = changePercent > 10 ? 'increasing' : changePercent < -10 ? 'decreasing' : 'stable'

    return { current, trend, changePercent }
  }

  // ── Financial regression ───────────────────────────────────────────────

  private forecastFinancial(
    readings: Array<{ ts: number; usdcBalance: number }>
  ) {
    if (readings.length < 3) {
      return {
        burnRate: 0,
        trajectory: 'stable' as FinancialTrajectory,
        confidence: 0,
        daysToThreshold: () => Infinity,
        latestBalance: readings[readings.length - 1]?.usdcBalance ?? 0,
      }
    }

    const latest = readings[readings.length - 1]

    // Use readings from last 7 days
    const cutoff7d = latest.ts - 7 * 24 * 3600_000
    const recent = readings.filter(r => r.ts >= cutoff7d)
    const window = recent.length >= 3 ? recent : readings

    const { slope, r2 } = linearRegression(
      window.map(r => r.ts),
      window.map(r => r.usdcBalance),
    )

    const burnRatePerDay = -slope * 86_400_000

    const trajectory: FinancialTrajectory =
      burnRatePerDay < 0    ? 'recovering' :
      burnRatePerDay < 0.20 ? 'stable' :
      burnRatePerDay < 1.00 ? 'depleting_slowly' :
      burnRatePerDay < 5.00 ? 'depleting_fast' :
                               'critical_soon'

    const daysToThreshold = (threshold: number): number => {
      if (burnRatePerDay <= 0) return Infinity
      const diff = latest.usdcBalance - threshold
      if (diff <= 0) return 0
      return diff / burnRatePerDay
    }

    return {
      burnRate: burnRatePerDay,
      trajectory,
      confidence: Math.min(1, r2 * (window.length / 20)),
      daysToThreshold,
      latestBalance: latest.usdcBalance,
    }
  }

  // ── Compute trend ──────────────────────────────────────────────────────

  private forecastCompute(
    readings: Array<{ ts: number; ramFreeMB: number }>
  ) {
    if (readings.length < 5) {
      return { trend: 'stable' as RamTrend, hoursUntilSevere: null, confidence: 0 }
    }

    const latest = readings[readings.length - 1]
    const cutoff2h = latest.ts - 2 * 3600_000
    const recent = readings.filter(r => r.ts >= cutoff2h)

    if (recent.length < 3) {
      return { trend: 'stable' as RamTrend, hoursUntilSevere: null, confidence: 0 }
    }

    const { slope, r2 } = linearRegression(
      recent.map(r => r.ts),
      recent.map(r => r.ramFreeMB),
    )

    const slopePerHour = slope * 3_600_000

    const trend: RamTrend =
      slopePerHour > 50   ? 'improving' :
      slopePerHour > -20  ? 'stable' :
      slopePerHour > -100 ? 'degrading_slowly' :
                             'degrading_fast'

    const SEVERE_THRESHOLD_MB = 1_024
    let hoursUntilSevere: number | null = null

    if (slopePerHour < 0 && latest.ramFreeMB > SEVERE_THRESHOLD_MB) {
      const hours = (latest.ramFreeMB - SEVERE_THRESHOLD_MB) / (-slopePerHour)
      if (hours < 24) hoursUntilSevere = hours
    }

    return {
      trend,
      hoursUntilSevere,
      confidence: Math.min(1, r2 * (recent.length / 10)),
    }
  }

  // ── Correlation detection ──────────────────────────────────────────────

  private detectCorrelations(
    readings: Array<{ ts: number; ramFreeMB: number; ollamaResponseMs: number }>
  ): SignalCorrelation[] {
    const corrs: SignalCorrelation[] = []
    if (readings.length < 10) return corrs

    const rams = readings.map(r => r.ramFreeMB)
    const olls = readings.map(r => r.ollamaResponseMs).filter(v => v > 0)

    if (olls.length >= 10) {
      const ramOllCorr = pearsonCorrelation(rams.slice(-olls.length), olls)
      if (Math.abs(ramOllCorr) > 0.5) {
        corrs.push({
          signal1: 'ram_free_mb',
          signal2: 'ollama_response_ms',
          description: ramOllCorr < 0
            ? 'RAM pressure correlates with Ollama slowdown — reduce memory use before inference'
            : 'RAM and Ollama latency moving together (unusual)',
          strength: Math.abs(ramOllCorr),
        })
      }
    }

    return corrs
  }

  // ── Human-readable output ──────────────────────────────────────────────

  private buildSummary(financial: any, compute: any, balance: number): string {
    const parts: string[] = []

    if (financial.burnRate > 0.01) {
      const days = financial.daysToThreshold(THRESHOLDS.low_compute)
      if (days < Infinity && days < 30) {
        parts.push(`At $${financial.burnRate.toFixed(2)}/day burn rate, low_compute in ${Math.round(days)} days`)
      } else {
        parts.push(`Burn rate $${financial.burnRate.toFixed(2)}/day — stable`)
      }
    } else {
      parts.push(`USDC stable at $${balance.toFixed(2)}`)
    }

    if (compute.hoursUntilSevere !== null) {
      parts.push(`RAM severe pressure predicted in ${Math.round(compute.hoursUntilSevere)}h`)
    }

    return parts.join('. ') + '.'
  }

  private buildRecommendations(financial: any, compute: any): string[] {
    const recs: string[] = []

    const daysToLC = financial.daysToThreshold(THRESHOLDS.low_compute)
    if (daysToLC < 7) {
      recs.push(`Request additional USDC funding — ${Math.round(daysToLC)} days until spend restrictions`)
    }
    if (financial.trajectory === 'depleting_fast') {
      recs.push('Review x402 spend — burn rate is high for current balance')
    }
    if (compute.trend === 'degrading_fast') {
      recs.push('Memory leak suspected — consider restarting agent runtime')
    }
    if (compute.hoursUntilSevere !== null && compute.hoursUntilSevere < 4) {
      recs.push('RAM severe pressure in < 4h — avoid spawning Docker children')
    }

    return recs
  }

  private emptyForecast(): ResourceForecast {
    return {
      currentBalance: 0, dailyBurnRate: 0,
      daysUntilLowCompute: Infinity, daysUntilCritical: Infinity, daysUntilDead: Infinity,
      financialTrajectory: 'stable', financialConfidence: 0,
      currentRamFreeMB: 0, ramTrend: 'stable', predictedSevereInHours: null, computeConfidence: 0,
      correlations: [], summary: 'Insufficient history for forecast.', recommendations: [],
      basedOnNReadings: 0, forecastTimestamp: Date.now(),
    }
  }
}

// ── Math helpers ─────────────────────────────────────────────────────────

function linearRegression(xs: number[], ys: number[]): { slope: number; intercept: number; r2: number } {
  const n = xs.length
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0, r2: 0 }

  const sumX  = xs.reduce((a, b) => a + b, 0)
  const sumY  = ys.reduce((a, b) => a + b, 0)
  const sumXY = xs.reduce((a, x, i) => a + x * ys[i], 0)
  const sumX2 = xs.reduce((a, x) => a + x * x, 0)

  const slope     = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
  const intercept = (sumY - slope * sumX) / n

  const yMean = sumY / n
  const ssTot = ys.reduce((a, y) => a + (y - yMean) ** 2, 0)
  const ssRes = ys.reduce((a, y, i) => a + (y - (slope * xs[i] + intercept)) ** 2, 0)
  const r2    = ssTot === 0 ? 1 : 1 - ssRes / ssTot

  return { slope, intercept, r2 }
}

function pearsonCorrelation(xs: number[], ys: number[]): number {
  const n  = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  const num = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0)
  const dx  = Math.sqrt(xs.reduce((a, x) => a + (x - mx) ** 2, 0))
  const dy  = Math.sqrt(ys.reduce((a, y) => a + (y - my) ** 2, 0))
  return dx * dy === 0 ? 0 : num / (dx * dy)
}
