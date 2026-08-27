/**
 * Conway Automaton — Credits & Survival Tier
 * Calculates survival tier from credit balance.
 */

import type { SurvivalTier } from '../types.js';
import { SURVIVAL_THRESHOLDS } from '../types.js';

export function calculateSurvivalTier(creditsCents: number): SurvivalTier {
  if (creditsCents >= SURVIVAL_THRESHOLDS.high) return 'high';
  if (creditsCents >= SURVIVAL_THRESHOLDS.normal) return 'normal';
  if (creditsCents >= SURVIVAL_THRESHOLDS.low_compute) return 'low_compute';
  if (creditsCents >= 0) return 'critical';
  return 'dead';
}

export function getTierThreshold(tier: SurvivalTier): number {
  return SURVIVAL_THRESHOLDS[tier] ?? -1;
}

export function canAffordCredits(tier: SurvivalTier): boolean {
  return tier === 'high' || tier === 'normal';
}
