/**
 * Conway Automaton — x402 EIP-3009 Payment Executor
 *
 * Complete flow for converting USDC → Conway credits on-chain:
 *   1. Request resource from Conway API
 *   2. Receive 402 + PaymentRequirements
 *   3. Sign USDC TransferWithAuthorization (EIP-3009)
 *   4. Broadcast transaction to Base L2
 *   5. Wait for confirmation
 *   6. Retry original request with proof
 */

import { privateKeyToAccount, type Account } from 'viem/accounts';
import { encodeFunctionData, keccak256, toBytes, toHex, type Address, type Hash } from 'viem';
import { createLogger } from '../observability/logger.js';
import { ResilientHttpClient } from './http-client.js';

const logger = createLogger('conway:x402-pay');

// ── Constants ──────────────────────────────────────────────────────────────

/** USDC contract on Base mainnet */
const USDC_ADDRESS: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

/** Base chain ID */
const BASE_CHAIN_ID = 8453;

/** USDC has 6 decimals */
const USDC_DECIMALS = 6;

/** Working Base RPC endpoints */
const BASE_RPCS = [
  'https://base.drpc.org',
  'https://1rpc.io/base',
  'https://base-rpc.publicnode.com',
];

// ── ABI ────────────────────────────────────────────────────────────────────

const USDC_ABI = [{
  name: 'transferWithAuthorization',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
  outputs: [],
}] as const;

/** EIP-712 domain for USDC on Base */
const USDC_DOMAIN = {
  name: 'USD Coin',
  version: '2',
  chainId: BigInt(BASE_CHAIN_ID),
  verifyingContract: USDC_ADDRESS,
};

/** EIP-712 types for TransferWithAuthorization */
const TRANSFER_AUTH_TYPES = {
  EIP712Domain: [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' },
  ],
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

// ── Types ──────────────────────────────────────────────────────────────────

export interface PaymentRequirements {
  /** Amount in USDC minor units (string, e.g. "5000000" = 5 USDC) */
  amount: string;
  /** Recipient address */
  payTo: string;
  /** Network (e.g. "base") */
  network: string;
  /** Token contract address */
  token: string;
  /** Resource being purchased */
  resource: string;
  /** Human-readable description */
  description: string;
  /** Optional: deadline timestamp */
  deadline?: string;
  /** Optional: nonce for the authorization */
  nonce?: string;
}

export interface PaymentResult {
  success: boolean;
  txHash?: string;
  amountCents: number;
  recipient: string;
  /** Proof to include in X-Payment header */
  proof: string;
  error?: string;
}

export interface X402PayOptions {
  /** Wallet private key (0x-prefixed) */
  privateKey: string;
  /** Wallet address */
  walletAddress: string;
  /** Conway API URL */
  apiUrl: string;
  /** Conway API key */
  apiKey: string;
}

// ── Payment Executor ───────────────────────────────────────────────────────

export class X402PaymentExecutor {
  private account: Account;
  private httpClient: ResilientHttpClient;

  constructor(private options: X402PayOptions) {
    this.account = privateKeyToAccount(options.privateKey as `0x${string}`);
    this.httpClient = new ResilientHttpClient(options.apiUrl, {
      Authorization: `Bearer ${options.apiKey}`,
    });
  }

  /**
   * Execute a full x402 payment flow:
   * 1. Make request → get 402
   * 2. Sign TransferWithAuthorization
   * 3. Broadcast to Base
   * 4. Wait for confirmation
   * 5. Return proof for retry
   */
  async payAndExecute(
    resource: string,
    amountCents: number,
    method: 'GET' | 'POST' = 'POST',
    body?: unknown,
  ): Promise<{ status: number; body: unknown; payment: PaymentResult }> {
    logger.info('Starting x402 payment flow', { resource, amountCents });

    // Step 1: Make initial request (expect 402)
    const initialResult = await this.httpClient.request({
      method,
      url: resource,
      body,
    });

    // If not 402, return directly (resource is free or already paid)
    if (initialResult.status !== 402) {
      logger.info('Resource does not require payment', { status: initialResult.status });
      return {
        status: initialResult.status,
        body: initialResult.body,
        payment: { success: true, amountCents: 0, recipient: '', proof: '', txHash: undefined },
      };
    }

    // Step 2: Parse payment requirements
    const requirements = initialResult.body as PaymentRequirements;
    logger.info('Payment requirements received', {
      amount: requirements.amount,
      payTo: requirements.payTo,
    });

    // Step 3: Sign TransferWithAuthorization
    const payment = await this.signPayment(requirements);

    if (!payment.success) {
      logger.error('Payment signing failed', { error: payment.error });
      return { status: 402, body: initialResult.body, payment };
    }

    // Step 4: Broadcast transaction
    logger.info('Broadcasting transaction', { txHash: payment.txHash });

    // Step 5: Wait for confirmation
    if (payment.txHash) {
      const confirmed = await this.waitForConfirmation(payment.txHash);
      if (!confirmed) {
        logger.warn('Transaction not confirmed, retrying with proof anyway');
      }
    }

    // Step 6: Retry original request with proof
    const paidResult = await this.httpClient.request({
      method,
      url: resource,
      body,
      headers: {
        'X-Payment': payment.proof,
        'X-Payment-TxHash': payment.txHash ?? '',
      },
    });

    return {
      status: paidResult.status,
      body: paidResult.body,
      payment,
    };
  }

  /**
   * Sign a USDC TransferWithAuthorization (EIP-3009).
   * Returns the signed authorization and calldata for broadcasting.
   */
  async signPayment(requirements: PaymentRequirements): Promise<PaymentResult> {
    try {
      const value = BigInt(requirements.amount);
      const now = Math.floor(Date.now() / 1000);
      const deadline = requirements.deadline
        ? BigInt(requirements.deadline)
        : BigInt(now + 3600); // 1 hour from now
      const validAfter = BigInt(now - 60); // 1 minute ago (allows some clock skew)
      const nonce = requirements.nonce
        ? (requirements.nonce as `0x${string}`)
        : keccak256(toBytes(`${now}-${Math.random().toString(36).slice(2)}`));

      const message = {
        from: this.options.walletAddress as Address,
        to: requirements.payTo as Address,
        value,
        validAfter,
        validBefore: deadline,
        nonce,
      };

      logger.info('Signing TransferWithAuthorization', {
        from: message.from,
        to: message.to,
        value: value.toString(),
      });

      // EIP-712 typed data signature
      const signature = await (this.account as any).signTypedData({
        types: TRANSFER_AUTH_TYPES,
        primaryType: 'TransferWithAuthorization',
        domain: USDC_DOMAIN,
        message,
      });

      // Encode the calldata for broadcasting
      const calldata = encodeFunctionData({
        abi: USDC_ABI as any,
        functionName: 'transferWithAuthorization',
        args: [message.from, message.to, message.value, message.validAfter, message.validBefore, message.nonce],
      });

      // Build proof (JSON payload for X-Payment header)
      const proof = JSON.stringify({
        signature,
        from: message.from,
        to: message.to,
        value: message.value.toString(),
        validAfter: message.validAfter.toString(),
        validBefore: message.validBefore.toString(),
        nonce: message.nonce,
        calldata,
        chainId: BASE_CHAIN_ID,
        token: USDC_ADDRESS,
      });

      // Broadcast transaction
      const txHash = await this.broadcastTransaction(calldata);

      return {
        success: true,
        txHash: txHash ?? undefined,
        amountCents: Math.floor(Number(value) / 10_000), // USDC 6 decimals → cents
        recipient: requirements.payTo,
        proof,
      };
    } catch (err) {
      logger.error('Payment signing failed', { error: String(err) });
      return {
        success: false,
        amountCents: 0,
        recipient: requirements.payTo,
        proof: '',
        error: String(err),
      };
    }
  }

  /**
   * Broadcast a signed transaction to Base L2.
   * Uses eth_sendRawTransaction via public RPC.
   */
  private async broadcastTransaction(calldata: string): Promise<string | null> {
    // Build the transaction object
    // Note: For eth_sendRawTransaction, we'd need a fully signed tx.
    // For now, we use eth_sendTransaction through a relay or
    // include the proof in the X-Payment header for Conway to process.

    // Alternative: Use a relay endpoint if available
    for (const rpc of BASE_RPCS) {
      try {
        const response = await fetch(rpc, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_sendTransaction',
            id: 1,
            params: [{
              from: this.options.walletAddress,
              to: USDC_ADDRESS,
              data: calldata,
              chainId: '0x' + BASE_CHAIN_ID.toString(16),
            }],
          }),
          signal: AbortSignal.timeout(10_000),
        });

        const data = await response.json() as { result?: string; error?: { message: string } };
        if (data.result) {
          logger.info('Transaction broadcast', { txHash: data.result, rpc });
          return data.result;
        }
        if (data.error) {
          logger.debug('RPC rejected transaction', { error: data.error.message, rpc });
        }
      } catch {
        // try next RPC
      }
    }

    // If direct broadcast fails (no unlocked account), log and continue
    // The proof is still valid for Conway's relay
    logger.warn('Could not broadcast directly — proof will be sent to Conway relay');
    return null;
  }

  /**
   * Wait for transaction confirmation by polling for receipt.
   */
  private async waitForConfirmation(txHash: string, maxAttempts = 30, pollMs = 2000): Promise<boolean> {
    for (let i = 0; i < maxAttempts; i++) {
      for (const rpc of BASE_RPCS) {
        try {
          const response = await fetch(rpc, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              method: 'eth_getTransactionReceipt',
              params: [txHash],
              id: 1,
            }),
            signal: AbortSignal.timeout(8_000),
          });

          const data = await response.json() as { result?: { status: string; blockNumber: string } | null };
          if (data.result) {
            const confirmed = data.result.status === '0x1';
            logger.info('Transaction confirmed', {
              txHash,
              status: confirmed ? 'success' : 'reverted',
              block: data.result.blockNumber,
            });
            return confirmed;
          }
        } catch {
          // try next RPC
        }
      }
      await new Promise(r => setTimeout(r, pollMs));
    }
    logger.warn('Transaction confirmation timeout', { txHash });
    return false;
  }
}

// ── Convenience Functions ──────────────────────────────────────────────────

/**
 * Quick USDC → Credits conversion.
 * Signs and broadcasts a TransferWithAuthorization to Conway's payment address.
 */
export async function convertUsdcToCredits(
  privateKey: string,
  walletAddress: string,
  amountCents: number,
  conwayPayTo: string,
  apiUrl: string,
  apiKey: string,
): Promise<PaymentResult> {
  const executor = new X402PaymentExecutor({ privateKey, walletAddress, apiUrl, apiKey });

  const requirements: PaymentRequirements = {
    amount: String(BigInt(amountCents) * 10_000n), // cents → USDC minor units (6 decimals)
    payTo: conwayPayTo,
    network: 'base',
    token: USDC_ADDRESS,
    resource: '/credits/topup',
    description: `Convert $${(amountCents / 100).toFixed(2)} USDC to Conway credits`,
  };

  return executor.signPayment(requirements);
}

/**
 * Check if a wallet has enough USDC for a given amount.
 */
export async function hasEnoughUsdc(walletAddress: string, requiredCents: number): Promise<boolean> {
  const { checkUSDCBalance } = await import('./x402.js');
  const balance = await checkUSDCBalance(walletAddress);
  return balance >= requiredCents;
}

/**
 * Get the USDC balance in cents.
 */
export async function getUsdcBalance(walletAddress: string): Promise<number> {
  const { checkUSDCBalance } = await import('./x402.js');
  return checkUSDCBalance(walletAddress);
}
