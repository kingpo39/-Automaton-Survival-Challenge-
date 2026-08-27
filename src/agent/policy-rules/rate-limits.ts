/**
 * Policy Rules — Rate Limits
 * Per-turn and per-session caps on expensive operations.
 */

import type { PolicyRule, PolicyContext, PolicyDecision } from '../../types.js';

const PER_TURN_LIMITS: Record<string, number> = {
  exec: 10,
  write_file: 10,
  edit_own_file: 5,
  spawn_child: 1,
  topup_credits: 2,
};

const PER_SESSION_LIMITS: Record<string, number> = {
  spawn_child: 3,
  topup_credits: 10,
  install_npm_package: 5,
  install_mcp_server: 3,
  git_push: 5,
};

export const rateLimitRules: PolicyRule[] = [
  {
    name: 'per_turn_rate_limit',
    category: 'rate_limits',
    priority: 50,
    evaluate(context: PolicyContext): PolicyDecision | null {
      const { toolName, turnNumber } = context;
      const limit = PER_TURN_LIMITS[toolName];
      if (!limit) return null;

      // We check sessionTurnCount as a proxy for turns-per-tool-per-session
      // In production, this would query the DB for precise per-turn counts
      if (context.sessionTurnCount > limit * 2) {
        return {
          action: 'deny',
          reason: `Per-turn rate limit exceeded for ${toolName} (max ${limit})`,
          rule: 'per_turn_rate_limit',
          category: 'rate_limits',
          priority: 50,
        };
      }

      return null;
    },
  },
  {
    name: 'per_session_rate_limit',
    category: 'rate_limits',
    priority: 51,
    evaluate(context: PolicyContext): PolicyDecision | null {
      const { toolName, sessionTurnCount } = context;
      const limit = PER_SESSION_LIMITS[toolName];
      if (!limit) return null;

      if (sessionTurnCount > limit) {
        return {
          action: 'deny',
          reason: `Per-session rate limit exceeded for ${toolName} (max ${limit})`,
          rule: 'per_session_rate_limit',
          category: 'rate_limits',
          priority: 51,
        };
      }

      return null;
    },
  },
];
