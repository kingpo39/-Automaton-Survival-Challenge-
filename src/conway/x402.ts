/**
 * Conway Automaton — x402 Payment Protocol
 * HTTP 402 payment flow with USDC TransferWithAuthorization (EIP-3009).
 */

import { createLogger } from '../observability/logger.js';
import { ResilientHttpClient } from './http-client.js';

const logger = createLogger('conway:x402');

export interface PaymentRequirements {
  network: string;
  token: string;
  amount: string;
  payTo: string;
  resource: string;
  description: string;
}

export interface X402Response {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * Execute an x402-protected HTTP request.
 * 1. Make request → receive 402 with payment requirements
 * 2. Sign USDC TransferWithAuthorization
 * 3. Retry with X-Payment header
 */
export async function x402Fetch(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    walletAddress: string;
    signPayment: (requirements: PaymentRequirements) => Promise<string>;
  },
): Promise<X402Response> {
  const httpClient = new ResilientHttpClient('');
  const method = options.method ?? 'GET';

  // First attempt
  const firstResult = await httpClient.request({
    method,
    url,
    headers: options.headers,
    body: options.body,
  });

  // If not 402, return directly
  if (firstResult.status !== 402) {
    return {
      status: firstResult.status,
      headers: firstResult.headers,
      body: firstResult.body,
    };
  }

  // Parse payment requirements from 402 response
  const paymentReq = firstResult.body as PaymentRequirements;
  logger.info('x402 payment required', { resource: paymentReq.resource, amount: paymentReq.amount });

  // Sign the payment
  const paymentHeader = await options.signPayment(paymentReq);

  // Retry with payment
  const paidResult = await httpClient.request({
    method,
    url,
    headers: {
      ...options.headers,
      'X-Payment': paymentHeader,
    },
    body: options.body,
  });

  return {
    status: paidResult.status,
    headers: paidResult.headers,
    body: paidResult.body,
  };
}

/**
 * Check USDC balance on Base mainnet.
 */
/** Working Base RPC endpoints (tried in order) */
const BASE_RPCS = [
  'https://base-rpc.publicnode.com',
  'https://1rpc.io/base',
  'https://base.drpc.org',
  'https://mainnet.base.org',
];

const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BALANCE_OF_SELECTOR = '0x70a08231';

/**
 * Check USDC balance on Base mainnet.
 * Tries multiple RPC endpoints with both node:fetch and curl fallback.
 */
export async function checkUSDCBalance(
  walletAddress: string,
  rpcUrl?: string,
): Promise<number> {
  const rpcs = rpcUrl ? [rpcUrl, ...BASE_RPCS] : BASE_RPCS;
  const paddedAddr = walletAddress.toLowerCase().replace('0x', '').padStart(40, '0');
  const callData = BALANCE_OF_SELECTOR + paddedAddr;

  for (const rpc of rpcs) {
    try {
      const response = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_call',
          params: [{ to: USDC_ADDRESS, data: callData }, 'latest'],
          id: 1,
        }),
        signal: AbortSignal.timeout(8_000),
      });

      const data = await response.json() as { result?: string };
      if (data.result) {
        // USDC has 6 decimals — result is uint256 hex
        const raw = BigInt(data.result);
        return Math.floor(Number(raw) / 1_000_000); // microgons → cents
      }
    } catch {
      // try next RPC
    }
  }

  // Fallback: use curl (works even when node:fetch is blocked)
  return checkUSDCBalanceCurl(walletAddress, rpcs);
}

/**
 * Curl-based USDC balance check (fallback for environments where node:fetch fails).
 */
function checkUSDCBalanceCurl(walletAddress: string, rpcs: string[]): number {
  try {
    const { execSync } = require('node:child_process') as typeof import('node:child_process');
    const paddedAddr = walletAddress.toLowerCase().replace('0x', '').padStart(40, '0');
    const callData = BALANCE_OF_SELECTOR + paddedAddr;
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_call',
      params: [{ to: USDC_ADDRESS, data: callData }, 'latest'],
      id: 1,
    });

    for (const rpc of rpcs) {
      try {
        const result = execSync(
          `curl -s -m 8 -X POST ${rpc} -H "Content-Type: application/json" -d '${payload.replace(/'/g, "'\"'\"'")}'`,
          { encoding: 'utf-8', timeout: 10_000 },
        );
        const parsed = JSON.parse(result) as { result?: string };
        if (parsed.result) {
          const raw = BigInt(parsed.result);
          return Math.floor(Number(raw) / 1_000_000);
        }
      } catch {
        // try next
      }
    }
  } catch {
    // curl not available
  }
  return 0;
}

/**
 * Check ETH balance on Base (for gas).
 */
export async function checkETHBalance(
  walletAddress: string,
  rpcUrl?: string,
): Promise<number> {
  const rpcs = rpcUrl ? [rpcUrl, ...BASE_RPCS] : BASE_RPCS;

  for (const rpc of rpcs) {
    try {
      const response = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_getBalance',
          params: [walletAddress, 'latest'],
          id: 1,
        }),
        signal: AbortSignal.timeout(8_000),
      });

      const data = await response.json() as { result?: string };
      if (data.result) {
        const raw = BigInt(data.result);
        // ETH has 18 decimals — return in wei as bigint string
        return Number(raw);
      }
    } catch {
      // try next
    }
  }
  return 0;
}
