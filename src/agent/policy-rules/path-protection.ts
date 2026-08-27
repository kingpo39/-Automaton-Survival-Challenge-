/**
 * Policy Rules — Path Protection
 * Blocks writes to protected files and reads of sensitive files.
 */

import type { PolicyRule, PolicyContext, PolicyDecision } from '../../types.js';
import { PROTECTED_FILES, SENSITIVE_FILES } from '../../types.js';

function getFilePath(params: Record<string, unknown>): string | undefined {
  return (params.path as string) ?? (params.filePath as string);
}

function basename(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] ?? '';
}

function isProtectedWrite(filePath: string): boolean {
  const base = basename(filePath);
  // Also check if it's in the .automaton directory root
  return PROTECTED_FILES.some(p => base === p || filePath.includes(p));
}

function isSensitiveRead(filePath: string): boolean {
  const base = basename(filePath);
  return SENSITIVE_FILES.some(p => base === p || filePath.includes(p));
}

export const pathProtectionRules: PolicyRule[] = [
  {
    name: 'protected_file_write',
    category: 'path_protection',
    priority: 40,
    evaluate(context: PolicyContext): PolicyDecision | null {
      const { toolName, params } = context;
      const writeTools = ['write_file', 'edit_own_file'];

      if (!writeTools.includes(toolName)) return null;

      const filePath = getFilePath(params);
      if (!filePath) return null;

      if (isProtectedWrite(filePath)) {
        return {
          action: 'deny',
          reason: `Write blocked to protected file: ${basename(filePath)}`,
          rule: 'protected_file_write',
          category: 'path_protection',
          priority: 40,
        };
      }

      return null;
    },
  },
  {
    name: 'sensitive_file_read',
    category: 'path_protection',
    priority: 41,
    evaluate(context: PolicyContext): PolicyDecision | null {
      const { toolName, params } = context;
      const readTools = ['read_file'];

      if (!readTools.includes(toolName)) return null;

      const filePath = getFilePath(params);
      if (!filePath) return null;

      if (isSensitiveRead(filePath)) {
        return {
          action: 'deny',
          reason: `Read blocked for sensitive file: ${basename(filePath)}`,
          rule: 'sensitive_file_read',
          category: 'path_protection',
          priority: 41,
        };
      }

      return null;
    },
  },
];
