/**
 * survival/actuators/index.ts
 * 
 * THE HANDS.
 * 
 * Executes actions when tier changes.
 * Handles system prompt updates, task interruption, and distress signals.
 * 
 * Core principle: ACT ON TRANSITION, NOT ON STATE.
 * We only act when the tier changes, not on every tick.
 */

import { createLogger } from '../../observability/logger.js'
import type { SurvivalTier } from '../../types.js'
import type { TierEvaluation } from '../tiers/evaluator.js'
import { TIER_LEVEL } from '../tiers/evaluator.js'

const log = createLogger('survival:actuators')

// ── Types ────────────────────────────────────────────────────────────────────

export interface TransitionResult {
  success: boolean
  actions: string[]
  warnings: string[]
}

// ── Actuator Layer ───────────────────────────────────────────────────────────

export class ActuatorLayer {

  constructor(
    private readonly options?: {
      onSystemPromptUpdate?: (tier: SurvivalTier) => void
      onDistressSignal?: (reason: string) => void
      onTaskInterruption?: () => void
    }
  ) {}

  /**
   * Handle tier transition.
   * Called only when tier changes, not on every tick.
   */
  async transition(
    previous: SurvivalTier,
    next: SurvivalTier,
    evaluation: TierEvaluation,
  ): Promise<TransitionResult> {
    const actions: string[] = []
    const warnings: string[] = []

    log.info('Tier transition', {
      from: previous,
      to: next,
      urgency: evaluation.urgency,
      reason: evaluation.reason,
    })

    // ── 1. Update system prompt ─────────────────────────────────────────
    this.updateSystemPrompt(next)
    actions.push('system_prompt_updated')

    // ── 2. Handle emergency transitions ─────────────────────────────────
    if (evaluation.urgency === 'emergency') {
      await this.handleEmergencyTransition(previous, next, evaluation)
      actions.push('emergency_handling_complete')
    }

    // ── 3. Send distress signal if needed ───────────────────────────────
    if (next === 'critical' || next === 'dead') {
      await this.sendDistressSignal(next, evaluation.reason)
      actions.push('distress_signal_sent')
    }

    // ── 4. Interrupt running tasks if tier dropped significantly ────────
    const drop = TIER_LEVEL[previous] - TIER_LEVEL[next]
    if (drop >= 2) {
      this.interruptRunningTasks()
      actions.push('tasks_interrupted')
    }

    // ── 5. Log transition for observability ─────────────────────────────
    this.logTransition(previous, next, evaluation, actions)

    return { success: true, actions, warnings }
  }

  // ── Internal Methods ─────────────────────────────────────────────────────

  private updateSystemPrompt(tier: SurvivalTier): void {
    try {
      if (this.options?.onSystemPromptUpdate) {
        this.options.onSystemPromptUpdate(tier)
      }
      log.debug('System prompt updated', { tier })
    } catch (err) {
      log.error('Failed to update system prompt', { error: String(err) })
    }
  }

  private async handleEmergencyTransition(
    previous: SurvivalTier,
    next: SurvivalTier,
    evaluation: TierEvaluation,
  ): Promise<void> {
    log.warn('Emergency transition', {
      from: previous,
      to: next,
      reason: evaluation.reason,
    })

    // Notify parent agent if available
    if (this.options?.onDistressSignal) {
      this.options.onDistressSignal(`Emergency: ${previous} → ${next}. ${evaluation.reason}`)
    }
  }

  private async sendDistressSignal(tier: SurvivalTier, reason: string): Promise<void> {
    try {
      const message = `Distress: Agent is at ${tier.toUpperCase()} tier. ${reason}`

      if (this.options?.onDistressSignal) {
        this.options.onDistressSignal(message)
      }

      log.warn('Distress signal sent', { tier, reason })
    } catch (err) {
      log.error('Failed to send distress signal', { error: String(err) })
    }
  }

  private interruptRunningTasks(): void {
    try {
      if (this.options?.onTaskInterruption) {
        this.options.onTaskInterruption()
      }
      log.info('Running tasks interrupted')
    } catch (err) {
      log.error('Failed to interrupt tasks', { error: String(err) })
    }
  }

  private logTransition(
    previous: SurvivalTier,
    next: SurvivalTier,
    evaluation: TierEvaluation,
    actions: string[],
  ): void {
    const logData = {
      from: previous,
      to: next,
      urgency: evaluation.urgency,
      reason: evaluation.reason,
      financial: evaluation.financialTier,
      compute: evaluation.computeTier,
      model: evaluation.modelTier,
      infra: evaluation.infraTier,
      actions,
    }

    if (evaluation.urgency === 'emergency') {
      log.error('Emergency tier transition', logData)
    } else {
      log.warn('Tier transition', logData)
    }
  }
}
