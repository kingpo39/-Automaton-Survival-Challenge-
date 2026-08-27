/**
 * Conway Automaton — SIWE Provisioning
 * Sign-In With Ethereum to get an API key from Conway.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createLogger } from '../observability/logger.js';

const logger = createLogger('identity:provision');

export interface ProvisionResult {
  apiKey: string;
  expiresAt: number;
}

/**
 * Provision an API key by signing a SIWE message.
 * If an existing valid API key exists, return it.
 */
export async function provisionApiKey(
  walletAddress: string,
  walletSigner: (message: string) => Promise<string>,
  conwayApiUrl: string,
  apiKeyPath: string,
): Promise<string> {
  // Check for existing key
  if (existsSync(apiKeyPath)) {
    const existing = readFileSync(apiKeyPath, 'utf-8').trim();
    if (existing) {
      logger.info('Using existing API key');
      return existing;
    }
  }

  // Generate SIWE message
  const nonce = crypto.randomUUID();
  const issuedAt = new Date().toISOString();
  const siweMessage = [
    `${new URL(conwayApiUrl).origin} wants you to sign in with your Ethereum account:`,
    walletAddress,
    '',
    'Conway Automaton Authentication',
    '',
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join('\n');

  // Sign
  const signature = await walletSigner(siweMessage);

  // Exchange for API key
  try {
    const response = await fetch(`${conwayApiUrl}/auth/siwe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: siweMessage,
        signature,
        address: walletAddress,
      }),
    });

    if (!response.ok) {
      throw new Error(`Provision failed: ${response.status}`);
    }

    const result = await response.json() as ProvisionResult;
    const apiKey = result.apiKey;

    // Save key
    const dir = dirname(apiKeyPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(apiKeyPath, apiKey, 'utf-8');

    logger.info('API key provisioned successfully');
    return apiKey;
  } catch (err) {
    logger.error('Provision failed', { error: String(err) });
    throw err;
  }
}
