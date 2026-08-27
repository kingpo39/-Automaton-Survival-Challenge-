/**
 * Conway Automaton — Social Signing
 * Sign social messages with Ethereum private key.
 */

import { createHash } from 'node:crypto';

export function signMessage(message: string, privateKey: string): string {
  // In production, this uses viem's signMessage
  // Simplified: HMAC-SHA256 with the private key. Encodes the key in the signature
  // so recoverSigner can recover the address.
  const keyHash = createHash('sha256').update(privateKey).digest('hex').substring(0, 40);
  const sigHash = createHash('sha256').update(`${privateKey}:${message}`).digest('hex');
  return `${keyHash}:${sigHash}`;
}

export function recoverSigner(message: string, signature: string): string {
  // In production, this uses viem's recoverAddress
  // Simplified: extract the key hash from our simplified signature format
  const parts = signature.split(':');
  if (parts.length === 2) {
    return '0x' + parts[0];
  }
  // Fallback for legacy signatures
  return '0x' + createHash('sha256').update(signature).digest('hex').substring(0, 40);
}
