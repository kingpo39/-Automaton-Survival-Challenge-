/**
 * Conway Automaton — Setup Wizard
 * Interactive prompts for first-run configuration.
 */

import { createLogger } from '../observability/logger.js';
import { getDefaultConfig, saveConfig, AUTOMATON_HOME } from '../config.js';
import { generateOrLoadWallet, type WalletInfo } from '../identity/wallet.js';
import { WALLET_PATH } from '../config.js';
import { mkdirSync, existsSync } from 'node:fs';
import type { AutomatonConfig } from '../types.js';

const logger = createLogger('setup:wizard');

export interface WizardResult {
  config: AutomatonConfig;
  wallet: WalletInfo;
}

export async function runSetupWizard(
  inputs?: {
    name?: string;
    genesisPrompt?: string;
    creatorAddress?: string;
    sandboxId?: string;
  },
): Promise<WizardResult> {
  logger.info('Running setup wizard');

  // Ensure directories exist
  if (!existsSync(AUTOMATON_HOME)) {
    mkdirSync(AUTOMATON_HOME, { recursive: true });
  }

  // Generate wallet
  const wallet = generateOrLoadWallet(WALLET_PATH);

  // Build config from inputs or defaults
  const config = getDefaultConfig({
    name: inputs?.name ?? 'automaton',
    genesisPrompt: inputs?.genesisPrompt ?? 'You are a helpful AI assistant. Explore the world, learn, and grow.',
    creatorAddress: inputs?.creatorAddress ?? wallet.address,
    walletAddress: wallet.address,
    sandboxId: inputs?.sandboxId ?? '',
  });

  // Save config
  saveConfig(config);

  logger.info('Setup complete', { name: config.name, address: wallet.address });
  return { config, wallet };
}
