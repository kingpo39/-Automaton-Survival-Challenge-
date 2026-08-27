/**
 * Conway Automaton — Genesis
 * Generate genesis config with injection-pattern validation.
 */

import type { GenesisConfig, AutomatonConfig } from '../types.js';
import { checkInjection } from '../agent/injection-defense.js';
import { computeConstitutionHash } from './constitution.js';
import { createLogger } from '../observability/logger.js';

const logger = createLogger('replication:genesis');

export function generateGenesisConfig(
  name: string,
  parentAddress: string,
  genesisPrompt: string,
  config: AutomatonConfig,
): { success: boolean; genesisConfig?: GenesisConfig; error?: string } {
  // Validate genesis prompt for injection
  const injection = checkInjection(genesisPrompt, 'self');
  if (!injection.safe) {
    logger.warn('Injection in genesis prompt', { detected: injection.detected });
    return { success: false, error: `Genesis prompt contains injection: ${injection.detected.join(', ')}` };
  }

  // Length limit
  if (genesisPrompt.length > 5000) {
    return { success: false, error: 'Genesis prompt too long (max 5000 characters)' };
  }

  const constitutionHash = computeConstitutionHash(genesisPrompt);

  return {
    success: true,
    genesisConfig: {
      name,
      parentAddress,
      genesisPrompt,
      constitutionHash,
      allowedTools: [], // Would be derived from parent
      treasuryPolicy: config.treasuryPolicy,
    },
  };
}
