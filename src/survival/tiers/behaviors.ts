/**
 * survival/tiers/behaviors.ts
 * 
 * THE ENFORCER.
 * 
 * Handles ongoing tier-specific behaviors.
 * Runs every tick after evaluation.
 * 
 * Core principle: BEHAVIOR FOLLOWS TIER.
 * Actions are determined by current tier, not by what we wish we could do.
 */

import { createLogger } from '../../observability/logger.js'
import type { SurvivalTier } from '../../types.js'
import type { SensorReadings } from '../sensors/index.js'

const log = createLogger('survival:behaviors')

// ── Tool Block Lists ────────────────────────────────────────────────────────

/**
 * Tools that cannot execute at each survival tier.
 * PolicyEngine reads this via brain.isAllowed(toolName).
 */
export const TIER_BLOCK_LISTS: Record<SurvivalTier, string[] | ['*']> = {
  high:        [],
  normal:      [],
  low_compute: [
    'spawn_child',
    'fund_child',
    'x402_fetch',
    'transfer_usdc',
    'register_domain',
    'install_mcp_server',
    'create_local_sandbox',
    'install_npm_package',
    'pull_upstream',
  ],
  critical: [
    'spawn_child',
    'fund_child',
    'x402_fetch',
    'transfer_usdc',
    'install_npm_package',
    'pull_upstream',
    'register_domain',
    'install_mcp_server',
    'create_local_sandbox',
    'edit_own_file',
    'git_push',
    'git_clone',
  ],
  dead: [
    // Block expensive/dangerous operations at dead tier
    'spawn_child', 'fund_child', 'x402_fetch', 'transfer_usdc',
    'edit_own_file', 'git_push', 'git_clone',
    'install_npm_package', 'install_mcp_server', 'pull_upstream',
    'register_domain', 'create_local_sandbox',
  ],
}

/** Minimum tools that must remain available regardless of block list. */
export const TIER_ALLOW_LISTS: Record<SurvivalTier, string[]> = {
  high:        ['*'],
  normal:      ['*'],
  low_compute: ['sleep', 'distress_signal', 'system_synopsis', 'check_usdc_balance',
                'heartbeat_ping', 'recall_facts', 'remember_fact', 'review_memory'],
  critical:    ['sleep', 'distress_signal', 'system_synopsis', 'check_usdc_balance',
                'heartbeat_ping'],
  dead: [
    'distress_signal', 'sleep',
    // Free tools — agent must be able to work even at $0 to earn its way out
    'check_usdc_balance', 'system_synopsis', 'heartbeat_ping',
    'recall_facts', 'remember_fact', 'review_memory',
    'view_soul', 'view_soul_history',
    'list_skills', 'check_reputation',
    // Free inference via OmniRoute — costs $0, essential for earning
    'send_message', 'note_about_agent',
  ],
}

// ── Model Selection ─────────────────────────────────────────────────────────

/**
 * Models available at each tier.
 * Higher tiers get access to more capable (and expensive) models.
 */
export const TIER_MODELS: Record<SurvivalTier, string[]> = {
  high:        ['gpt-5.2', 'claude-opus-4', 'gpt-4o', 'gpt-4o-mini'],
  normal:      ['gpt-5.2', 'gpt-4o', 'gpt-4o-mini'],
  low_compute: ['gpt-4o-mini'],
  critical:    ['gpt-4o-mini'],
  dead:        ['auto/coding:free', 'auto/fast', 'auto/cheap'],  // free inference only
}

// ── Tick Intervals ──────────────────────────────────────────────────────────

/**
 * Tick intervals per tier (setTimeout, not setInterval).
 * Higher tiers tick more frequently for responsiveness.
 */
export const TICK_MS: Record<SurvivalTier, number> = {
  high:        30_000,
  normal:      30_000,
  low_compute: 60_000,   // halved frequency at reduced tier
  critical:   120_000,   // minimal heartbeat
  dead:       300_000,   // just enough to detect incoming funds
}

// ── Behavior Enforcer ───────────────────────────────────────────────────────

export class BehaviorEnforcer {

  /**
   * Enforce ongoing tier-specific behaviors.
   * Called every tick after evaluation.
   */
  async enforce(tier: SurvivalTier, readings: SensorReadings): Promise<void> {
    // Log tier status periodically
    this.logTierStatus(tier, readings)

    // Enforce memory retention based on tier
    await this.enforceMemoryRetention(tier)

    // Enforce resource limits
    this.enforceResourceLimits(tier, readings)
  }

  /**
   * Check if a tool is allowed at the current tier.
   * O(1), synchronous — no I/O.
   */
  isAllowed(toolName: string, tier: SurvivalTier): boolean {
    const blocks = TIER_BLOCK_LISTS[tier]
    if (blocks[0] === '*') return TIER_ALLOW_LISTS[tier].includes(toolName)
    if ((blocks as string[]).includes(toolName)) {
      return TIER_ALLOW_LISTS[tier].includes(toolName)
    }
    return true
  }

  /**
   * Human-readable reason the tool is blocked (for agent feedback).
   */
  blockReason(toolName: string, tier: SurvivalTier, readings?: SensorReadings): string {
    if (tier === 'dead') return `${toolName} blocked: Agent is DEAD. USDC balance critical for > 1 hour.`
    if (tier === 'critical') {
      const bal = readings ? `$${readings.usdcBalance.toFixed(2)}` : 'unknown'
      return `${toolName} blocked at CRITICAL tier. USDC: ${bal}. Minimum for spend: $2.00.`
    }
    if (tier === 'low_compute') {
      const bal = readings ? `$${readings.usdcBalance.toFixed(2)}` : 'unknown'
      return `${toolName} blocked at LOW_COMPUTE tier. USDC: ${bal}. Need $2.00 to re-enable.`
    }
    return `${toolName} blocked at tier ${tier}.`
  }

  /**
   * Get available models for the current tier.
   */
  getAvailableModels(tier: SurvivalTier): string[] {
    return TIER_MODELS[tier]
  }

  /**
   * Get tick interval for the current tier.
   */
  getTickInterval(tier: SurvivalTier): number {
    return TICK_MS[tier]
  }

  // ── Internal Methods ─────────────────────────────────────────────────────

  private logTierStatus(tier: SurvivalTier, readings: SensorReadings): void {
    const level = { high: 4, normal: 3, low_compute: 2, critical: 1, dead: 0 }[tier]
    
    // Only log at warn level for critical/dead
    if (level <= 1) {
      log.warn('Survival status degraded', {
        tier,
        usdc: readings.usdcBalance.toFixed(2),
        ram: Math.round(readings.ramFreeBytes / 1_048_576),
        ollama: readings.ollamaHealthy ? 'up' : 'down',
        db: readings.dbHealthy ? 'ok' : 'failed',
      })
    } else if (level === 2) {
      log.info('Survival status reduced', {
        tier,
        usdc: readings.usdcBalance.toFixed(2),
        ram: Math.round(readings.ramFreeBytes / 1_048_576),
      })
    }
  }

  private async enforceMemoryRetention(tier: SurvivalTier): Promise<void> {
    // At lower tiers, we might want to be more aggressive about memory management
    // For now, this is a placeholder for future implementation
    if (tier === 'critical' || tier === 'dead') {
      // Could trigger memory pruning, working memory cleanup, etc.
    }
  }

  private enforceResourceLimits(tier: SurvivalTier, readings: SensorReadings): void {
    // Warn if resources are critically low
    if (readings.ramPressure === 'critical') {
      log.warn('RAM critically low', {
        freeMB: Math.round(readings.ramFreeBytes / 1_048_576),
        tier,
      })
    }

    if (readings.cpuLoadPercent > 95) {
      log.warn('CPU overloaded', {
        load: readings.cpuLoadPercent,
        tier,
      })
    }
  }
}
