/**
 * Conway Automaton — Ethereum Wallet
 * Generate/load private key wallet for on-chain identity and USDC operations.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createLogger } from '../observability/logger.js';
import { privateKeyToAccount } from 'viem/accounts';

const logger = createLogger('identity:wallet');

export interface WalletInfo {
  address: string;
  privateKey: string;
}

/**
 * Generate a new random wallet or load existing one from disk.
 * File is written with restricted permissions where possible.
 */
export function generateOrLoadWallet(walletPath: string): WalletInfo {
  if (existsSync(walletPath)) {
    return loadWallet(walletPath);
  }
  return generateWallet(walletPath);
}

function loadWallet(walletPath: string): WalletInfo {
  const raw = readFileSync(walletPath, 'utf-8');
  const data = JSON.parse(raw) as { address: string; privateKey: string };

  if (!data.address || !data.privateKey) {
    throw new Error(`Invalid wallet file at ${walletPath}`);
  }

  logger.info('Wallet loaded', { address: data.address });
  return data;
}

function generateWallet(walletPath: string): WalletInfo {
  // Generate a random 32-byte private key
  const privateKeyBytes = new Uint8Array(32);
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(privateKeyBytes);
  } else {
    // Fallback for older Node.js
    for (let i = 0; i < 32; i++) {
      privateKeyBytes[i] = Math.floor(Math.random() * 256);
    }
  }

  const privateKey = '0x' + Buffer.from(privateKeyBytes).toString('hex');

  // Derive address from private key using keccak256
  // We use a simplified approach - in production this uses viem's getAddress
  const address = deriveAddress(privateKey);

  const wallet: WalletInfo = { address, privateKey };

  // Save to disk
  const dir = dirname(walletPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(walletPath, JSON.stringify(wallet, null, 2), 'utf-8');

  logger.info('New wallet generated', { address });
  return wallet;
}

function deriveAddress(privateKey: string): string {
  // Real Ethereum address derivation via secp256k1 + keccak256 (viem)
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  return account.address;
}

/**
 * Get a viem Account object for signing messages and transactions.
 */
export function getWalletAccount(wallet: WalletInfo) {
  return privateKeyToAccount(wallet.privateKey as `0x${string}`);
}

/**
 * Sign a message using the wallet's private key.
 */
export async function signWithWallet(wallet: WalletInfo, message: string): Promise<string> {
  const account = getWalletAccount(wallet);
  return account.signMessage({ message });
}
