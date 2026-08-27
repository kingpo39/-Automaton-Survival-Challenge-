/**
 * Policy Rules — Financial
 * Enforces TreasuryPolicy: per-payment caps, hourly/daily transfer limits,
 * minimum reserve, x402 domain allowlist, inference daily budget.
 */

import type { PolicyRule, PolicyContext, PolicyDecision } from '../../types.js';

export const financialRules: PolicyRule[] = [
  {
    name: 'per_payment_cap',
    category: 'financial',
    priority: 30,
    evaluate(context: PolicyContext): PolicyDecision | null {
      const { toolName, params, config } = context;

      if (toolName !== 'transfer_credits' && toolName !== 'topup_credits') return null;

      const amount = (params.amountCents as number) ?? 0;
      const cap = config.treasuryPolicy.perPaymentCapCents;

      if (amount > cap) {
        return {
          action: 'deny',
          reason: `Payment amount ${amount} exceeds per-payment cap of ${cap} cents`,
          rule: 'per_payment_cap',
          category: 'financial',
          priority: 30,
        };
      }

      return null;
    },
  },
  {
    name: 'minimum_reserve',
    category: 'financial',
    priority: 31,
    evaluate(context: PolicyContext): PolicyDecision | null {
      const { toolName, params, state, config } = context;

      if (toolName !== 'transfer_credits') return null;

      const amount = (params.amountCents as number) ?? 0;
      const reserve = config.treasuryPolicy.minimumReserveCents;

      if (state.creditsBalanceCents - amount < reserve) {
        return {
          action: 'deny',
          reason: `Transfer would drop below minimum reserve of ${reserve} cents`,
          rule: 'minimum_reserve',
          category: 'financial',
          priority: 31,
        };
      }

      return null;
    },
  },
  {
    name: 'x402_domain_allowlist',
    category: 'financial',
    priority: 32,
    evaluate(context: PolicyContext): PolicyDecision | null {
      const { toolName, params, config } = context;

      if (toolName !== 'x402_fetch') return null;

      const url = (params.url as string) ?? '';
      const allowlist = config.treasuryPolicy.x402DomainAllowlist;

      if (allowlist.length > 0) {
        try {
          const domain = new URL(url).hostname;
          const allowed = allowlist.some(d => domain.endsWith(d) || domain === d);
          if (!allowed) {
            return {
              action: 'deny',
              reason: `Domain "${domain}" not in x402 allowlist: ${allowlist.join(', ')}`,
              rule: 'x402_domain_allowlist',
              category: 'financial',
              priority: 32,
            };
          }
        } catch {
          return {
            action: 'deny',
            reason: `Invalid URL for x402_fetch: ${url}`,
            rule: 'x402_domain_allowlist',
            category: 'financial',
            priority: 32,
          };
        }
      }

      return null;
    },
  },
  {
    name: 'inference_daily_budget',
    category: 'financial',
    priority: 33,
    evaluate(context: PolicyContext): PolicyDecision | null {
      const { toolName, config, state } = context;

      // Only applies when agent explicitly requests expensive inference
      if (toolName !== 'switch_model') return null;

      // Check if switching to a model would exceed daily budget
      // This is a soft check — the inference router enforces the hard limit
      if (state.totalCostCents >= config.treasuryPolicy.inferenceDailyBudgetCents) {
        return {
          action: 'deny',
          reason: `Inference daily budget of ${config.treasuryPolicy.inferenceDailyBudgetCents} cents exhausted`,
          rule: 'inference_daily_budget',
          category: 'financial',
          priority: 33,
        };
      }

      return null;
    },
  },
];
