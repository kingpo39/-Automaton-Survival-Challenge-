/**
 * Conway Automaton — Credit Topup
 * Buy Conway credits from USDC via x402 EIP-3009 payment protocol.
 *
 * Flow:
 *   1. Request topup from Conway API
 *   2. Receive 402 PaymentRequirements (amount, payTo, etc.)
 *   3. Sign USDC TransferWithAuthorization (EIP-3009)
 *   4. Broadcast transaction to Base L2
 *   5. Return proof to Conway API for credit issuance
 */

import type { ConwayClient } from '../types.js';
import { createLogger } from '../observability/logger.js';
import { BOOTSTRAP_TOPUP_CENTS } from '../types.js';
import { X402PaymentExecutor, type PaymentRequirements, type PaymentResult } from './x402-pay.js';
import { checkUSDCBalance } from './x402.js';
import { ResilientHttpClient } from './http-client.js';

const logger = createLogger('conway:topup');

export const TOPUP_TIERS = [500, 2500, 10000, 50000, 100000, 250000] as const; // cents

/** Conway's payment address (where USDC is sent) */
const CONWAY_PAY_TO = '0x0000000000000000000000000000000000000001'; // placeholder — set via config

export interface TopupResult {
  success: boolean;
  amountCents: number;
  txHash?: string;
  proof?: string;
  error?: string;
}

/**
 * Bootstrap topup: buy enough credits to start operating.
 */
export async function bootstrapTopup(
  conwayClient: ConwayClient,
  currentBalance: number,
  walletOptions?: { privateKey?: string; walletAddress?: string; apiUrl?: string; apiKey?: string },
): Promise<TopupResult> {
  if (currentBalance >= BOOTSTRAP_TOPUP_CENTS) {
    logger.info('Sufficient credits for bootstrap', { balance: currentBalance });
    return { success: true, amountCents: 0 };
  }

  const tier = TOPUP_TIERS.find(t => t >= BOOTSTRAP_TOPUP_CENTS) ?? TOPUP_TIERS[0];
  logger.info('Bootstrap topup', { targetTier: tier });
  return executeTopup(conwayClient, tier, walletOptions);
}

/**
 * Execute a credit topup via x402 EIP-3009 payment.
 *
 * 1. Check USDC balance is sufficient
 * 2. Request topup from Conway API (gets 402 + requirements)
 * 3. Sign TransferWithAuthorization
 * 4. Broadcast to Base L2
 * 5. Return proof for credit issuance
 */
export async function executeTopup(
  conwayClient: ConwayClient,
  amountCents: number,
  walletOptions?: { privateKey?: string; walletAddress?: string; apiUrl?: string; apiKey?: string },
): Promise<TopupResult> {
  if (!TOPUP_TIERS.includes(amountCents as typeof TOPUP_TIERS[number])) {
    throw new Error(`Invalid topup amount: ${amountCents}. Valid tiers: ${TOPUP_TIERS.join(', ')}`);
  }

  logger.info('Executing topup', { amountCents, amountDollars: (amountCents / 100).toFixed(2) });

  // Step 1: Check USDC balance
  if (walletOptions?.walletAddress) {
    const usdcBalance = await checkUSDCBalance(walletOptions.walletAddress);
    if (usdcBalance < amountCents) {
      const msg = `Insufficient USDC: have $${(usdcBalance / 100).toFixed(2)}, need $${(amountCents / 100).toFixed(2)}`;
      logger.warn('Topup failed — insufficient USDC', { usdcBalance, required: amountCents });
      return { success: false, amountCents, error: msg };
    }
  }

  // Step 2: Request topup from Conway API
  try {
    const http = new ResilientHttpClient(walletOptions?.apiUrl ?? '', {
      Authorization: `Bearer ${walletOptions?.apiKey ?? ''}`,
    });
    const topupResponse = await http.post('/credits/topup', {
      amountCents,
      network: 'base',
      token: 'USDC',
    });

    // If Conway returns 402 with payment requirements
    if (topupResponse.status === 402) {
      const requirements = topupResponse.body as PaymentRequirements;
      logger.info('Payment requirements received', {
        amount: requirements.amount,
        payTo: requirements.payTo,
      });

      // Step 3-4: Sign and broadcast via x402 executor
      if (walletOptions?.privateKey && walletOptions?.walletAddress) {
        const executor = new X402PaymentExecutor({
          privateKey: walletOptions.privateKey,
          walletAddress: walletOptions.walletAddress,
          apiUrl: walletOptions.apiUrl ?? '',
          apiKey: walletOptions.apiKey ?? '',
        });

        const payment = await executor.signPayment(requirements);

        if (!payment.success) {
          logger.error('Payment signing failed', { error: payment.error });
          return { success: false, amountCents, error: payment.error };
        }

        logger.info('Payment signed and broadcast', {
          txHash: payment.txHash,
          amountCents: payment.amountCents,
        });

        // Step 5: Return proof for credit issuance
        return {
          success: true,
          amountCents: payment.amountCents,
          txHash: payment.txHash,
          proof: payment.proof,
        };
      }
    }

    // If Conway accepted directly (pre-paid or free)
    logger.info('Topup accepted by Conway');
    return { success: true, amountCents };
  } catch (err) {
    // Conway API might not be available — try direct x402
    logger.warn('Conway API unavailable, attempting direct x402', { error: String(err) });

    if (walletOptions?.privateKey && walletOptions?.walletAddress) {
      // Direct x402: sign and broadcast without Conway API
      const executor = new X402PaymentExecutor({
        privateKey: walletOptions.privateKey,
        walletAddress: walletOptions.walletAddress,
        apiUrl: walletOptions.apiUrl ?? '',
        apiKey: walletOptions.apiKey ?? '',
      });

      const requirements: PaymentRequirements = {
        amount: String(BigInt(amountCents) * 10_000n), // cents → USDC minor units
        payTo: CONWAY_PAY_TO,
        network: 'base',
        token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        resource: '/credits/topup',
        description: `Convert $${(amountCents / 100).toFixed(2)} USDC to Conway credits`,
      };

      const payment = await executor.signPayment(requirements);

      if (payment.success) {
        logger.info('Direct x402 payment signed', { txHash: payment.txHash });
        return {
          success: true,
          amountCents: payment.amountCents,
          txHash: payment.txHash,
          proof: payment.proof,
        };
      }

      return { success: false, amountCents, error: payment.error };
    }

    logger.error('Topup failed — no wallet credentials', { error: String(err) });
    return { success: false, amountCents, error: String(err) };
  }
}

export function getTopupTierDisplay(amountCents: number): string {
  return `$${(amountCents / 100).toFixed(2)}`;
}
