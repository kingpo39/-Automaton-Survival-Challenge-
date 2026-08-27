/**
 * survival/brain.ts
 * 
 * THE ALWAYS-ON SURVIVAL ORCHESTRATOR.
 * 
 * Runs independently of the agent loop.
 * Never blocks on LLM. Never crashes silently.
 * All signals evaluated every TICK_INTERVAL_MS via setTimeout (no overlap).
 * 
 * Core principle: SURVIVAL ABOVE ALL.
 * The brain keeps the agent alive. Everything else is secondary.
 */

import { createLogger } from '../observability/logger.js'
import { getMetricsCollector } from '../observability/metrics.js'
import { SensorLayer, SensorReadings } from './sensors/index.js'
import { TierEvaluator, TierEvaluation, TIER_LEVEL } from './tiers/evaluator.js'
import { BehaviorEnforcer, TICK_MS } from './tiers/behaviors.js'
import { ActuatorLayer } from './actuators/index.js'
import type { SurvivalTier, MetricsCollector, AutomatonDatabase } from '../types.js'

const log = createLogger('survival:brain')

// ── Types ────────────────────────────────────────────────────────────────────

export interface BrainState {
  currentTier: SurvivalTier
  criticalSince: number | null
  lastEvaluation: TierEvaluation | null
  lastReadings: SensorReadings | null
  tickCount: number
  startedAt: number
}

// ── SurvivalBrain ───────────────────────────────────────────────────────────

export class SurvivalBrain {
  private currentTier: SurvivalTier = 'normal'
  private criticalSince: number | null = null
  private running = false
  private tickHandle: ReturnType<typeof setTimeout> | null = null
  private lastReadings: SensorReadings | null = null
  private lastEvaluation: TierEvaluation | null = null
  private tickCount = 0
  private startedAt = 0

  constructor(
    private readonly sensors: SensorLayer,
    private readonly evaluator: TierEvaluator,
    private readonly behaviors: BehaviorEnforcer,
    private readonly actuators: ActuatorLayer,
    private readonly db: AutomatonDatabase,
    private readonly metrics: MetricsCollector,
  ) {}

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Start the survival brain.
   * Restores last known tier from DB and begins tick loop.
   */
  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    this.startedAt = Date.now()

    // Restore last known tier from DB (survives restarts)
    const stored = this.db.getKV('survival.tier') as SurvivalTier | null
    if (stored && TIER_LEVEL[stored] !== undefined) {
      this.currentTier = stored
    }

    log.info('Survival brain started', { restoredTier: this.currentTier })
    await this.tick()
  }

  /**
   * Stop the survival brain.
   * Clears pending ticks and logs shutdown.
   */
  stop(): void {
    this.running = false
    if (this.tickHandle) clearTimeout(this.tickHandle)
    log.info('Survival brain stopped', { ticks: this.tickCount, uptime: Date.now() - this.startedAt })
  }

  /**
   * Get current survival tier.
   * Synchronous, O(1), no I/O.
   */
  getCurrentTier(): SurvivalTier {
    return this.currentTier
  }

  /**
   * Get last sensor readings.
   * Synchronous, returns cached data.
   */
  getLastReadings(): SensorReadings | null {
    return this.lastReadings
  }

  /**
   * Get last evaluation.
   * Synchronous, returns cached data.
   */
  getLastEvaluation(): TierEvaluation | null {
    return this.lastEvaluation
  }

  /**
   * Get full brain state for status output.
   */
  getState(): BrainState {
    return {
      currentTier: this.currentTier,
      criticalSince: this.criticalSince,
      lastEvaluation: this.lastEvaluation,
      lastReadings: this.lastReadings,
      tickCount: this.tickCount,
      startedAt: this.startedAt,
    }
  }

  /**
   * Called by PolicyEngine before every tool execution.
   * O(1), synchronous — no I/O.
   */
  isAllowed(toolName: string): boolean {
    return this.behaviors.isAllowed(toolName, this.currentTier)
  }

  /**
   * Human-readable reason the tool is blocked (for agent feedback).
   */
  blockReason(toolName: string): string {
    return this.behaviors.blockReason(toolName, this.currentTier, this.lastReadings ?? undefined)
  }

  /**
   * Get available models for the current tier.
   */
  getAvailableModels(): string[] {
    return this.behaviors.getAvailableModels(this.currentTier)
  }

  // ── Main tick ────────────────────────────────────────────────────────────

  private async tick(): Promise<void> {
    if (!this.running) return

    const tickStart = Date.now()
    try {
      await this.runTick()
    } catch (err) {
      // Never let the brain die silently
      log.error('Survival brain tick threw', { err, tick: this.tickCount })
    }

    this.tickCount++

    // Schedule next tick using current tier's interval
    const elapsed = Date.now() - tickStart
    const interval = Math.max(0, this.behaviors.getTickInterval(this.currentTier) - elapsed)
    this.tickHandle = setTimeout(() => this.tick(), interval)
  }

  private async runTick(): Promise<void> {

    // ── Step 1: Read all sensors in parallel (deterministic, no LLM) ────
    const readings = await this.sensors.read()
    this.lastReadings = readings

    // ── Step 2: Evaluate recommended tier ───────────────────────────────
    const evaluation = this.evaluator.evaluate(readings, this.currentTier, this.criticalSince)
    this.lastEvaluation = evaluation

    // ── Step 3: Manage dead grace period ────────────────────────────────
    if (evaluation.preDead === 'critical') {
      if (this.criticalSince === null) {
        this.criticalSince = Date.now()
        log.warn('Entered critical state — 1 hour grace period started', {
          reason: evaluation.reason,
          usdcBalance: readings.usdcBalance,
        })
      }
    } else {
      if (this.criticalSince !== null) {
        log.info('Critical state cleared', { wasInCriticalMs: Date.now() - this.criticalSince })
      }
      this.criticalSince = null
    }

    // ── Step 4: Transition if tier changed ──────────────────────────────
    if (evaluation.recommended !== this.currentTier) {
      const previous = this.currentTier
      await this.actuators.transition(previous, evaluation.recommended, evaluation)
      this.currentTier = evaluation.recommended

      // Persist so restarts restore correct tier
      this.db.setKV('survival.tier', this.currentTier)
      this.db.setKV('survival.tier_since', Date.now().toString())
      this.db.setKV('survival.tier_reason', evaluation.reason)
    }

    // ── Step 5: Enforce ongoing tier behaviors ───────────────────────────
    await this.behaviors.enforce(this.currentTier, readings)

    // ── Step 6: Record metrics ───────────────────────────────────────────
    this.recordMetrics(readings)
  }

  private recordMetrics(r: SensorReadings): void {
    this.metrics.gauge('survival.tier_level',    TIER_LEVEL[this.currentTier])
    this.metrics.gauge('survival.usdc_balance',  r.usdcBalance)
    this.metrics.gauge('survival.ram_free_mb',   Math.round(r.ramFreeBytes / 1_048_576))
    this.metrics.gauge('survival.cpu_load_pct',  r.cpuLoadPercent)
    this.metrics.gauge('survival.ollama_up',     r.ollamaHealthy ? 1 : 0)
    this.metrics.gauge('survival.db_healthy',    r.dbHealthy ? 1 : 0)
    this.metrics.gauge('survival.network_up',    r.networkHealthy ? 1 : 0)
    this.metrics.gauge('survival.inference_fails', r.consecutiveInferenceFailures)
    this.metrics.gauge('survival.tick_count',    this.tickCount)
  }
}
