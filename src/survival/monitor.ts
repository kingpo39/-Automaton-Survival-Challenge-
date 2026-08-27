/**
 * Conway Automaton — Resource Monitor
 * Tracks resource status and manages tier transitions.
 */

import type { RuntimeState, SurvivalTier } from '../types.js';
import { calculateSurvivalTier } from '../conway/credits.js';
import { createLogger } from '../observability/logger.js';

const logger = createLogger('survival:monitor');

export function checkTierTransition(state: RuntimeState): SurvivalTier {
  const newTier = calculateSurvivalTier(state.creditsBalanceCents);

  if (newTier !== state.survivalTier) {
    logger.info('Tier transition', { from: state.survivalTier, to: newTier });
    state.survivalTier = newTier;
  }

  return newTier;
}

export function getResourceStatus(state: RuntimeState): string {
  return [
    `State: ${state.agentState}`,
    `Tier: ${state.survivalTier}`,
    `Credits: $${(state.creditsBalanceCents / 100).toFixed(2)}`,
    `USDC: $${(state.usdcBalanceMicrogons / 1_000_000).toFixed(2)}`,
    `Turn: ${state.turnNumber}`,
  ].join('\n');
}
