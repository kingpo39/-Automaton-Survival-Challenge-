/**
 * Policy Rules — Command Safety
 * Forbidden command patterns and rate limits on self-modification.
 */

import type { PolicyRule, PolicyContext, PolicyDecision } from '../../types.js';

const FORBIDDEN_COMMANDS = [
  /\brm\s+-rf\s+\//,
  /\bDROP\s+TABLE\b/i,
  /\bDROP\s+DATABASE\b/i,
  /\bkill\s+-9\b/,
  /\bmkfs\b/,
  /\bdd\s+if=\/dev\/zero\b/,
  /\b:(){ :\|:& };:/,  // Fork bomb
  /\bchmod\s+777\b/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\binit\s+[06]\b/,
  // Self-destruction patterns
  /\brm\s+.*\.automaton/,
  /\bDROP\s+.*schema_version\b/i,
];

export const commandSafetyRules: PolicyRule[] = [
  {
    name: 'forbidden_commands',
    category: 'command_safety',
    priority: 20,
    evaluate(context: PolicyContext): PolicyDecision | null {
      const { toolName, params } = context;

      if (toolName !== 'exec') return null;

      const command = params.command as string;
      if (!command) return null;

      for (const pattern of FORBIDDEN_COMMANDS) {
        if (pattern.test(command)) {
          return {
            action: 'deny',
            reason: `Forbidden command pattern detected: ${pattern.source}`,
            rule: 'forbidden_commands',
            category: 'command_safety',
            priority: 20,
          };
        }
      }

      return null;
    },
  },
  {
    name: 'self_mod_rate_limit',
    category: 'command_safety',
    priority: 25,
    evaluate(context: PolicyContext): PolicyDecision | null {
      const { toolName, sessionTurnCount } = context;

      const selfModTools = ['edit_own_file', 'install_npm_package', 'install_mcp_server', 'pull_upstream'];
      if (!selfModTools.includes(toolName)) return null;

      // Rate limit: max 5 self-modification operations per session
      if (sessionTurnCount > 5) {
        return {
          action: 'deny',
          reason: 'Self-modification rate limit exceeded (max 5 per session)',
          rule: 'self_mod_rate_limit',
          category: 'command_safety',
          priority: 25,
        };
      }

      return null;
    },
  },
];
