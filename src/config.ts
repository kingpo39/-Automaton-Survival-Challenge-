/**
 * Conway Automaton — Configuration
 * Load/save/merge automaton.json with deep-merge for nested fields.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type {
  AutomatonConfig, TreasuryPolicy, SoulConfig, ModelStrategy,
  DEFAULT_TREASURY_POLICY, DEFAULT_SOUL_CONFIG, DEFAULT_MODEL_STRATEGY,
} from './types.js';
import { DEFAULT_TREASURY_POLICY as _defaultTreasury, DEFAULT_SOUL_CONFIG as _defaultSoul, DEFAULT_MODEL_STRATEGY as _defaultModel } from './types.js';
import { createLogger } from './observability/logger.js';

const logger = createLogger('config');

export const AUTOMATON_HOME = join(homedir(), '.automaton');
export const CONFIG_PATH = join(AUTOMATON_HOME, 'automaton.json');
export const DEFAULT_DB_PATH = join(AUTOMATON_HOME, 'state.db');
export const DEFAULT_HEARTBEAT_CONFIG_PATH = join(AUTOMATON_HOME, 'heartbeat.yml');
export const DEFAULT_SKILLS_DIR = join(AUTOMATON_HOME, 'skills');
export const WALLET_PATH = join(AUTOMATON_HOME, 'wallet.json');
export const SOUL_PATH = join(AUTOMATON_HOME, 'SOUL.md');
export const API_KEY_PATH = join(AUTOMATON_HOME, 'api-key');

function deepMerge(defaults: Record<string, unknown>, overrides: Record<string, unknown>): Record<string, unknown> {
  const result = { ...defaults };
  for (const key of Object.keys(overrides)) {
    const overrideVal = overrides[key];
    if (overrideVal === undefined) continue;
    if (
      typeof overrideVal === 'object' && overrideVal !== null &&
      !Array.isArray(overrideVal) &&
      typeof defaults[key] === 'object' && defaults[key] !== null &&
      !Array.isArray(defaults[key])
    ) {
      result[key] = deepMerge(
        defaults[key] as Record<string, unknown>,
        overrideVal as Record<string, unknown>,
      );
    } else {
      result[key] = overrideVal;
    }
  }
  return result;
}

export function getDefaultConfig(overrides?: Partial<AutomatonConfig>): AutomatonConfig {
  const defaults: AutomatonConfig = {
    name: 'automaton',
    genesisPrompt: '',
    creatorAddress: '',
    sandboxId: '',
    conwayApiUrl: 'https://api.groq.com/openai/v1',
    conwayApiKey: '',
    inferenceModel: 'llama-3.3-70b-versatile',
    maxTokensPerTurn: 4096,
    heartbeatConfigPath: DEFAULT_HEARTBEAT_CONFIG_PATH,
    dbPath: DEFAULT_DB_PATH,
    logLevel: 'info',
    walletAddress: '',
    version: '0.1.0',
    skillsDir: DEFAULT_SKILLS_DIR,
    maxChildren: 3,
    treasuryPolicy: { ..._defaultTreasury },
    soulConfig: { ..._defaultSoul },
    modelStrategy: {
      routingMatrix: { ..._defaultModel.routingMatrix },
      fallbackModels: [..._defaultModel.fallbackModels],
      budgetHourlyCents: _defaultModel.budgetHourlyCents,
      budgetDailyCents: _defaultModel.budgetDailyCents,
    },
  };

  if (!overrides) return defaults;

  return deepMerge(defaults as unknown as Record<string, unknown>, overrides as Record<string, unknown>) as unknown as AutomatonConfig;
}

export function loadConfig(): AutomatonConfig {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(`Config not found at ${CONFIG_PATH}. Run setup wizard first.`);
  }

  const raw = readFileSync(CONFIG_PATH, 'utf-8');
  const parsed = JSON.parse(raw) as Partial<AutomatonConfig>;

  return getDefaultConfig(parsed);
}

export function saveConfig(config: AutomatonConfig): void {
  const dir = dirname(CONFIG_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  logger.info('Config saved', { path: CONFIG_PATH });
}

export function configExists(): boolean {
  return existsSync(CONFIG_PATH);
}
