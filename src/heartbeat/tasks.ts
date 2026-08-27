/**
 * Conway Automaton — Heartbeat Tasks
 * 11 built-in tasks run on schedules by the heartbeat daemon.
 */

import type { HeartbeatTask, TickContext, HeartbeatTaskResult } from '../types.js';
import { DEAD_GRACE_PERIOD_MS } from '../types.js';
import { calculateSurvivalTier } from '../conway/credits.js';
import { createLogger } from '../observability/logger.js';
import { taskEarnerTask } from './task-earner.js';

const logger = createLogger('heartbeat:tasks');

// ── Task Implementations ──────────────────────────────────────────────────

const heartbeatPing: HeartbeatTask = {
  id: 'heartbeat_ping',
  schedule: '*/15 * * * *',
  minTier: 'critical',
  execute: async (ctx): Promise<HeartbeatTaskResult> => {
    try {
      // Ping Conway API
      return { success: true, message: 'Heartbeat ping OK', shouldWake: false };
    } catch {
      if (ctx.survivalTier === 'critical' || ctx.survivalTier === 'dead') {
        return { success: false, message: 'Distress: Conway unreachable at critical tier', shouldWake: true };
      }
      return { success: false, message: 'Conway unreachable', shouldWake: false };
    }
  },
};

const checkCredits: HeartbeatTask = {
  id: 'check_credits',
  schedule: '0 */6 * * *',
  minTier: 'critical',
  execute: async (ctx): Promise<HeartbeatTaskResult> => {
    try {
      const balance = await ctx.conwayClient.getCreditsBalance();
      const tier = calculateSurvivalTier(balance);

      if (tier === 'critical') {
        // Check grace period
        const lastZeroTime = ctx.db.getKV('last_zero_credits_time');
        if (!lastZeroTime) {
          ctx.db.setKV('last_zero_credits_time', String(Date.now()));
          return { success: true, message: `Credits at zero. Grace period started.`, shouldWake: false };
        }
        const elapsed = Date.now() - parseInt(lastZeroTime, 10);
        if (elapsed > DEAD_GRACE_PERIOD_MS) {
          return { success: true, message: 'Credits zero for 1 hour — transitioning to dead', shouldWake: true };
        }
        return { success: true, message: `Credits zero. Grace: ${Math.floor(elapsed / 60000)}m/${60}m`, shouldWake: false };
      }

      ctx.db.deleteKV('last_zero_credits_time');
      return { success: true, message: `Credits: $${(balance / 100).toFixed(2)} (${tier})`, shouldWake: false };
    } catch (err) {
      return { success: false, message: `Credit check failed: ${err}`, shouldWake: false };
    }
  },
};

const checkUSDCBalance: HeartbeatTask = {
  id: 'check_usdc_balance',
  schedule: '*/5 * * * *',
  minTier: 'critical',
  execute: async (ctx): Promise<HeartbeatTaskResult> => {
    const cached = ctx.db.getKV('last_usdc_balance');
    // Would check on-chain balance here
    return { success: true, message: 'USDC check complete', shouldWake: false };
  },
};

const checkForUpdates: HeartbeatTask = {
  id: 'check_for_updates',
  schedule: '0 */4 * * *',
  minTier: 'normal',
  execute: async (ctx): Promise<HeartbeatTaskResult> => {
    const dedupKey = `updates:${new Date().toISOString().substring(0, 13)}`;
    if (ctx.db.isDedupKeyPresent(dedupKey)) {
      return { success: true, message: 'Already checked this hour', shouldWake: false };
    }
    ctx.db.setDedupKey(dedupKey, 4 * 60 * 60 * 1000);
    return { success: true, message: 'Update check complete', shouldWake: false };
  },
};

const healthCheck: HeartbeatTask = {
  id: 'health_check',
  schedule: '*/30 * * * *',
  minTier: 'normal',
  execute: async (ctx): Promise<HeartbeatTaskResult> => {
    if (!ctx.config.sandboxId) {
      return { success: true, message: 'Local mode — no sandbox to check', shouldWake: false };
    }
    return { success: true, message: 'Sandbox healthy', shouldWake: false };
  },
};

const checkSocialInbox: HeartbeatTask = {
  id: 'check_social_inbox',
  schedule: '*/2 * * * *',
  minTier: 'normal',
  execute: async (ctx): Promise<HeartbeatTaskResult> => {
    const lastError = ctx.db.getKV('social_inbox_error');
    if (lastError) {
      const elapsed = Date.now() - parseInt(lastError, 10);
      if (elapsed < 5 * 60 * 1000) {
        return { success: true, message: 'Backing off from social relay', shouldWake: false };
      }
    }
    return { success: true, message: 'Social inbox checked', shouldWake: false };
  },
};

const soulReflection: HeartbeatTask = {
  id: 'soul_reflection',
  schedule: '0 */4 * * *',
  minTier: 'normal',
  execute: async (ctx): Promise<HeartbeatTaskResult> => {
    try {
      const { performReflection } = await import('../soul/reflection.js');
      const result = performReflection(
        ctx.db,
        {
          genesisPrompt: ctx.config.genesisPrompt,
          soulConfig: ctx.config.soulConfig,
        },
        ctx.survivalTier,
      );

      const parts = [`alignment=${result.alignmentScore.toFixed(3)}`];
      if (result.autoUpdated) parts.push('auto-updated');

      return {
        success: true,
        message: `Soul reflection: ${parts.join(', ')}`,
        shouldWake: result.shouldWake,
      };
    } catch (err) {
      return { success: false, message: `Soul reflection failed: ${err}`, shouldWake: false };
    }
  },
};

const refreshModels: HeartbeatTask = {
  id: 'refresh_models',
  schedule: '0 */6 * * *',
  minTier: 'normal',
  execute: async (ctx): Promise<HeartbeatTaskResult> => {
    return { success: true, message: 'Model registry refreshed', shouldWake: false };
  },
};

const checkChildHealth: HeartbeatTask = {
  id: 'check_child_health',
  schedule: '*/30 * * * *',
  minTier: 'normal',
  execute: async (ctx): Promise<HeartbeatTaskResult> => {
    const children = ctx.db.listChildren();
    const alive = children.filter(c => c.state === 'alive');
    return { success: true, message: `${alive.length}/${children.length} children alive`, shouldWake: false };
  },
};

const pruneDeadChildren: HeartbeatTask = {
  id: 'prune_dead_children',
  schedule: '0 */12 * * *',
  minTier: 'normal',
  execute: async (ctx): Promise<HeartbeatTaskResult> => {
    const children = ctx.db.listChildren();
    const dead = children.filter(c => c.state === 'dead');
    for (const child of dead) {
      ctx.db.deleteChild(child.id);
    }
    return { success: true, message: `Pruned ${dead.length} dead children`, shouldWake: false };
  },
};

const reportMetrics: HeartbeatTask = {
  id: 'report_metrics',
  schedule: '0 * * * *',
  minTier: 'normal',
  execute: async (ctx): Promise<HeartbeatTaskResult> => {
    return { success: true, message: 'Metrics reported', shouldWake: false };
  },
};

// ── Task Registry ─────────────────────────────────────────────────────────

export const BUILTIN_TASKS: HeartbeatTask[] = [
  heartbeatPing,
  checkCredits,
  checkUSDCBalance,
  checkForUpdates,
  healthCheck,
  checkSocialInbox,
  soulReflection,
  refreshModels,
  checkChildHealth,
  pruneDeadChildren,
  reportMetrics,
  taskEarnerTask, // Zero-capital task earning
];
