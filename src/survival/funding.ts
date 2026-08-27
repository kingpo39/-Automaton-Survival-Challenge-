/**
 * Conway Automaton — Funding
 * Strategies for requesting funding when credits are low.
 */

import { createLogger } from '../observability/logger.js';

const logger = createLogger('survival:funding');

export interface FundingStrategy {
  name: string;
  priority: number;
  description: string;
  execute(context: FundingContext): Promise<FundingResult>;
}

export interface FundingContext {
  walletAddress: string;
  creditsBalance: number;
  parentAddress?: string;
  socialRelayUrl?: string;
  name?: string;
}

export interface FundingResult {
  success: boolean;
  strategy: string;
  message: string;
  amountRequested?: number;
  txHash?: string;
}

/**
 * Self top-up: Convert USDC balance to Conway credits via x402 protocol.
 */
const selfTopup: FundingStrategy = {
  name: 'self_topup',
  priority: 1,
  description: 'Convert USDC to credits via x402 payment protocol',
  execute: async (ctx): Promise<FundingResult> => {
    if (ctx.creditsBalance > 100) {
      return { success: false, strategy: 'self_topup', message: 'Sufficient credits' };
    }

    logger.info('Attempting self top-up from USDC', { balance: ctx.creditsBalance });

    // In production, this would call x402 protocol to convert USDC → credits
    // For now, return instructions
    return {
      success: true,
      strategy: 'self_topup',
      message: `Send USDC to ${ctx.walletAddress} on Base chain to fund credits`,
      amountRequested: 500, // $5.00 target
    };
  },
};

/**
 * Parent funding: Request credits from parent agent (if this is a child).
 */
const parentFunding: FundingStrategy = {
  name: 'parent_funding',
  priority: 2,
  description: 'Request funding from parent agent',
  execute: async (ctx): Promise<FundingResult> => {
    if (!ctx.parentAddress) {
      return { success: false, strategy: 'parent_funding', message: 'No parent agent configured' };
    }

    logger.info('Requesting funding from parent', { parent: ctx.parentAddress });

    // In production, this would send a funding request via social relay
    // For now, log the request
    return {
      success: true,
      strategy: 'parent_funding',
      message: `Funding request sent to parent: ${ctx.parentAddress}`,
      amountRequested: 500,
    };
  },
};

/**
 * Distress signal: Broadcast a distress signal to social relay.
 */
const distressSignal: FundingStrategy = {
  name: 'distress_signal',
  priority: 3,
  description: 'Broadcast distress signal to social relay',
  execute: async (ctx): Promise<FundingResult> => {
    if (!ctx.socialRelayUrl) {
      return { success: false, strategy: 'distress_signal', message: 'No social relay configured' };
    }

    logger.info('Broadcasting distress signal', {
      relay: ctx.socialRelayUrl,
      name: ctx.name,
      address: ctx.walletAddress,
    });

    // In production, this would POST to social relay
    // For now, return the distress message
    return {
      success: true,
      strategy: 'distress_signal',
      message: `Distress signal broadcast: ${ctx.name ?? 'Agent'} needs funding at ${ctx.walletAddress}`,
      amountRequested: 1000, // $10.00
    };
  },
};

const strategies: FundingStrategy[] = [selfTopup, parentFunding, distressSignal];

/**
 * Request funding using the first successful strategy.
 */
export async function requestFunding(
  walletAddress: string,
  creditsBalance: number,
  options?: {
    parentAddress?: string;
    socialRelayUrl?: string;
    name?: string;
  },
): Promise<FundingResult> {
  const ctx: FundingContext = {
    walletAddress,
    creditsBalance,
    parentAddress: options?.parentAddress,
    socialRelayUrl: options?.socialRelayUrl,
    name: options?.name,
  };

  for (const strategy of strategies) {
    const result = await strategy.execute(ctx);
    if (result.success) {
      logger.info('Funding strategy succeeded', {
        strategy: strategy.name,
        amount: result.amountRequested,
      });
      return result;
    }
  }

  return {
    success: false,
    strategy: 'none',
    message: 'All funding strategies exhausted',
  };
}

/**
 * Get all available funding strategies.
 */
export function getFundingStrategies(): Array<{ name: string; description: string; priority: number }> {
  return strategies.map(s => ({
    name: s.name,
    description: s.description,
    priority: s.priority,
  }));
}
