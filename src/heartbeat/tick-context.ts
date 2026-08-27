/**
 * Conway Automaton — Tick Context
 * Builds shared context for each heartbeat tick.
 */

import type { TickContext, AutomatonConfig, AutomatonDatabase, ConwayClient, InferenceClient } from '../types.js';
import { calculateSurvivalTier } from '../conway/credits.js';
import { createLogger } from '../observability/logger.js';

const logger = createLogger('heartbeat:tick-context');

export function buildTickContextBuilder(
  config: AutomatonConfig,
  db: AutomatonDatabase,
  conwayClient: ConwayClient,
  inferenceClient: InferenceClient,
): () => Promise<TickContext> {
  return async (): Promise<TickContext> => {
    let creditsBalance = 0;
    let usdcBalance = 0;

    try {
      creditsBalance = await conwayClient.getCreditsBalance();
    } catch (err) {
      logger.warn('Failed to fetch credits balance', { error: String(err) });
      // Use cached value
      const cached = db.getKV('last_credits_balance');
      creditsBalance = cached ? parseInt(cached, 10) : 0;
    }

    try {
      // Would check USDC balance via x402
      const cached = db.getKV('last_usdc_balance');
      usdcBalance = cached ? parseInt(cached, 10) : 0;
    } catch { /* use 0 */ }

    // Cache balances
    db.setKV('last_credits_balance', String(creditsBalance));
    db.setKV('last_usdc_balance', String(usdcBalance));

    return {
      creditsBalance,
      usdcBalance,
      survivalTier: calculateSurvivalTier(creditsBalance),
      config,
      db,
      conwayClient,
      inferenceClient,
      logger,
    };
  };
}
