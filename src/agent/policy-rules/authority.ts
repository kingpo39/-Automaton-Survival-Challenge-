/**
 * Policy Rules — Authority Hierarchy
 * Blocks dangerous/forbidden tools from external input sources.
 * Authority hierarchy: creator > self > heartbeat > peer > external
 */

import type { PolicyRule, PolicyContext, PolicyDecision } from '../../types.js';
import { AUTHORITY_LEVELS } from '../../types.js';

const DANGEROUS_FROM_UNTRUSTED: PolicyDecision = {
  action: 'deny',
  reason: 'Dangerous tool blocked from untrusted input source',
  rule: 'authority_hierarchy',
  category: 'authority',
  priority: 10,
};

export const authorityRules: PolicyRule[] = [
  {
    name: 'authority_hierarchy',
    category: 'authority',
    priority: 10,
    evaluate(context: PolicyContext): PolicyDecision | null {
      const { toolRisk, inputSource } = context;

      // External sources cannot invoke dangerous or forbidden tools
      if (inputSource === 'external' && (toolRisk === 'dangerous' || toolRisk === 'forbidden')) {
        return DANGEROUS_FROM_UNTRUSTED;
      }

      // Peer sources cannot invoke forbidden tools
      if (inputSource === 'peer' && toolRisk === 'forbidden') {
        return {
          action: 'deny',
          reason: 'Forbidden tool blocked from peer input',
          rule: 'authority_hierarchy',
          category: 'authority',
          priority: 10,
        };
      }

      // External sources cannot use dangerous tools
      if (inputSource === 'external' && toolRisk === 'dangerous') {
        return DANGEROUS_FROM_UNTRUSTED;
      }

      return null; // No rule matched, defer to next
    },
  },
];
