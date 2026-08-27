/**
 * Conway Automaton — Policy Engine
 * Rule-based system that evaluates every tool call before execution.
 * Rules sorted by priority; first deny wins. All decisions audited.
 */

import type {
  PolicyContext, PolicyDecision, PolicyRule, ToolRiskLevel,
  InputSource, RuntimeState, AutomatonDatabase,
} from '../types.js';
import { createLogger } from '../observability/logger.js';
import { authorityRules } from './policy-rules/authority.js';
import { commandSafetyRules } from './policy-rules/command-safety.js';
import { financialRules } from './policy-rules/financial.js';
import { pathProtectionRules } from './policy-rules/path-protection.js';
import { rateLimitRules } from './policy-rules/rate-limits.js';
import { validationRules } from './policy-rules/validation.js';

const logger = createLogger('agent:policy-engine');

export class PolicyEngine {
  private rules: PolicyRule[];

  constructor() {
    this.rules = [
      ...authorityRules,
      ...commandSafetyRules,
      ...financialRules,
      ...pathProtectionRules,
      ...rateLimitRules,
      ...validationRules,
    ].sort((a, b) => a.priority - b.priority);
  }

  /**
   * Evaluate a tool call against all rules.
   * Returns the first deny, or allow if all rules pass.
   */
  evaluate(context: PolicyContext): PolicyDecision {
    for (const rule of this.rules) {
      const decision = rule.evaluate(context);
      if (decision) {
        if (decision.action === 'deny') {
          logger.info('Tool call denied', {
            tool: context.toolName,
            rule: rule.name,
            category: rule.category,
            reason: decision.reason,
          });
        }
        return decision;
      }
    }

    // Default: allow
    return {
      action: 'allow',
      reason: 'No rules matched — default allow',
      rule: 'default',
      category: 'default',
      priority: 9999,
    };
  }

  /**
   * Evaluate and persist the decision to the database.
   */
  evaluateAndRecord(context: PolicyContext, db: AutomatonDatabase): PolicyDecision {
    const decision = this.evaluate(context);

    db.insertPolicyDecision({
      timestamp: Date.now(),
      toolName: context.toolName,
      action: decision.action,
      reason: decision.reason,
      rule: decision.rule,
      category: decision.category,
      inputSource: context.inputSource,
      params: JSON.stringify(context.params),
    });

    return decision;
  }

  getRules(): PolicyRule[] {
    return [...this.rules];
  }
}
