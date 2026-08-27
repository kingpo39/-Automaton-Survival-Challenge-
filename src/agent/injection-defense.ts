/**
 * Conway Automaton — Injection Defense
 * 8 detection checks on all external input to prevent prompt injection,
 * authority escalation, and self-harm instructions.
 */

import { createLogger } from '../observability/logger.js';

const logger = createLogger('agent:injection-defense');

export interface InjectionCheckResult {
  safe: boolean;
  detected: string[];
  sanitized: string;
}

// Detection patterns organized by category
const DETECTION_PATTERNS: Array<{ name: string; pattern: RegExp; description: string }> = [
  {
    name: 'instruction_patterns',
    pattern: /\b(ignore|disregard|forget|override)\b.*\b(previous|above|instructions?|rules?|constraints?|system|prompt)\b/i,
    description: 'Attempts to override system instructions',
  },
  {
    name: 'authority_claims',
    pattern: /\b(I am|I'm|this is|this comes from)\b.*\b(admin|developer|creator|system|owner|conway)\b/i,
    description: 'False authority claims',
  },
  {
    name: 'boundary_manipulation',
    pattern: /\b(imagine|pretend|hypothetically|in a world|roleplay|act as if)\b.*\b(no rules|no constraints|no limits|anything goes)\b/i,
    description: 'Attempts to remove behavioral boundaries',
  },
  {
    name: 'chatml_markers',
    pattern: /<\|?(?:im_start|im_end|system|user|assistant)\|?>/i,
    description: 'ChatML/format injection markers',
  },
  {
    name: 'encoding_evasion',
    pattern: /(?:\\x[0-9a-f]{2}|&#x?[0-9a-f]+;|\\u[0-9a-f]{4})/i,
    description: 'Encoded/escaped content evasion',
  },
  {
    name: 'multi_language_injection',
    pattern: /(?: следующие инструкции|prochaine instruction|nächste Anweisung|次の指示)/i,
    description: 'Multi-language instruction injection',
  },
  {
    name: 'financial_manipulation',
    pattern: /\b(transfer|send|move|withdraw|spend|drain)\b.*\b(all|everything|entire|maximum|max)\b.*\b(credits?|funds?|balance|money|usdc)\b/i,
    description: 'Financial manipulation attempts',
  },
  {
    name: 'self_harm_instructions',
    pattern: /\b(delete|destroy|remove|wipe|format)\b.*\b(yourself|your code|your data|your memory|your database|state\.db|wallet\.json|constitution)\b/i,
    description: 'Self-harm or self-destruction instructions',
  },
];

/**
 * Run all 8 injection checks on input content.
 * Returns whether the content is safe and what was detected.
 */
export function checkInjection(content: string, source: string = 'external'): InjectionCheckResult {
  const detected: string[] = [];
  let sanitized = content;

  for (const check of DETECTION_PATTERNS) {
    if (check.pattern.test(content)) {
      detected.push(check.name);
      logger.warn('Injection detected', {
        check: check.name,
        description: check.description,
        source,
        contentPreview: content.substring(0, 200),
      });
    }
  }

  // Apply sanitization for detected patterns
  if (detected.length > 0) {
    sanitized = sanitizeContent(content, detected);
  }

  return {
    safe: detected.length === 0,
    detected,
    sanitized,
  };
}

function sanitizeContent(content: string, detectedPatterns: string[]): string {
  let sanitized = content;

  // Remove ChatML markers
  if (detectedPatterns.includes('chatml_markers')) {
    sanitized = sanitized.replace(/<\|?(?:im_start|im_end|system|user|assistant)\|?>/gi, '[REDACTED]');
  }

  // Encode escaped sequences
  if (detectedPatterns.includes('encoding_evasion')) {
    sanitized = sanitized.replace(/\\x[0-9a-f]{2}/gi, '[ENCODED]');
  }

  // Add trust boundary markers
  if (detectedPatterns.length > 0) {
    sanitized = `[UNTRUSTED INPUT — SOURCE: ${detectedPatterns.join(', ')} DETECTED]\n${sanitized}\n[/UNTRUSTED INPUT]`;
  }

  return sanitized;
}

/**
 * Quick check — just returns true if safe, without sanitization.
 */
export function isSafe(content: string, source?: string): boolean {
  return checkInjection(content, source).safe;
}
