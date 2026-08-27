/**
 * Conway Automaton — Social Validation
 * Verify signed messages from other agents.
 */

import { recoverSigner } from './signing.js';
import { checkInjection } from '../agent/injection-defense.js';
import { createLogger } from '../observability/logger.js';

const logger = createLogger('social:validation');

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  sanitizedContent?: string;
}

export function validateMessage(
  content: string,
  signature: string,
  expectedFrom: string,
  maxAgeMs = 5 * 60 * 1000,
  timestamp: number = Date.now(),
): ValidationResult {
  // Check freshness
  const age = Date.now() - timestamp;
  if (age > maxAgeMs || age < -60_000) {
    return { valid: false, reason: 'Message too old or from the future' };
  }

  // Check content size
  if (content.length > 10_000) {
    return { valid: false, reason: 'Message too large' };
  }

  // Verify signature
  const recoveredAddress = recoverSigner(content, signature);
  if (recoveredAddress.toLowerCase() !== expectedFrom.toLowerCase()) {
    logger.warn('Signature mismatch', { expected: expectedFrom, recovered: recoveredAddress });
    return { valid: false, reason: 'Signature verification failed' };
  }

  // Injection defense
  const injection = checkInjection(content, 'peer');
  if (!injection.safe) {
    logger.warn('Injection detected in peer message', { detected: injection.detected });
    return { valid: true, sanitizedContent: injection.sanitized };
  }

  return { valid: true, sanitizedContent: content };
}
