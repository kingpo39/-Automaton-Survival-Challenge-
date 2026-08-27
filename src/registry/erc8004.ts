/**
 * Conway Automaton — ERC-8004
 * On-chain contract interaction for agent registration.
 */

import { createLogger } from '../observability/logger.js';

const logger = createLogger('registry:erc8004');

const ERC8004_ADDRESS = '0x0000000000000000000000000000000000000000'; // Placeholder

export async function registerOnchain(
  walletAddress: string,
  agentCardJson: string,
  chainRpcUrl: string,
): Promise<{ txHash: string }> {
  // Would use viem to call ERC-8004 register function
  logger.info('ERC-8004 registration', { address: walletAddress });
  return { txHash: '0x0000000000000000000000000000000000000000000000000000000000000000' };
}

export async function queryAgent(
  walletAddress: string,
  chainRpcUrl: string,
): Promise<{ name: string; card: Record<string, unknown> } | null> {
  // Would query ERC-8004 contract
  return null;
}
