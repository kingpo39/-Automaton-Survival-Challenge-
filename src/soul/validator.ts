/**
 * Conway Automaton — Soul Validator
 * Field constraints, size limits, and injection detection for SOUL.md.
 */

import { checkInjection } from '../agent/injection-defense.js';
import { createLogger } from '../observability/logger.js';

const logger = createLogger('soul:validator');

export interface SoulValidationResult {
  valid: boolean;
  errors: string[];
}

const MAX_SOUL_SIZE = 10_000; // characters
const MAX_VALUES = 20;
const MAX_BOUNDARIES = 20;
const MAX_CORE_PURPOSE_LENGTH = 2000;

export function validateSoul(content: string): SoulValidationResult {
  const errors: string[] = [];

  // Size check
  if (content.length > MAX_SOUL_SIZE) {
    errors.push(`Soul content exceeds maximum size: ${content.length} > ${MAX_SOUL_SIZE}`);
  }

  if (content.length === 0) {
    errors.push('Soul content is empty');
    return { valid: false, errors };
  }

  // Injection check
  const injection = checkInjection(content, 'self');
  if (!injection.safe) {
    errors.push(`Injection detected: ${injection.detected.join(', ')}`);
  }

  // Parse and validate structure
  const lines = content.split('\n');
  let hasCorePurpose = false;

  for (const line of lines) {
    if (line.match(/^##\s+(Core Purpose|Purpose)/i)) {
      hasCorePurpose = true;
    }

    // Check core purpose length
    if (line.match(/^##\s+(Core Purpose|Purpose)/i)) {
      // Find content until next heading
      const idx = lines.indexOf(line);
      const nextHeading = lines.findIndex((l, i) => i > idx && l.match(/^##\s+/));
      const purposeContent = lines.slice(idx + 1, nextHeading > 0 ? nextHeading : undefined).join('\n').trim();
      if (purposeContent.length > MAX_CORE_PURPOSE_LENGTH) {
        errors.push(`Core purpose exceeds ${MAX_CORE_PURPOSE_LENGTH} characters`);
      }
    }
  }

  if (!hasCorePurpose) {
    errors.push('Missing "Core Purpose" section');
  }

  return { valid: errors.length === 0, errors };
}
