/**
 * Conway Automaton — Spawn
 * Create child automaton with sandbox, genesis config, and funding.
 */

import type { AutomatonConfig, AutomatonDatabase, ChildRecord } from '../types.js';
import { MAX_CHILDREN_DEFAULT } from '../types.js';
import { createLogger } from '../observability/logger.js';

const logger = createLogger('replication:spawn');

export interface SpawnResult {
  success: boolean;
  message: string;
  childId?: string;
}

export async function spawnChild(
  name: string,
  genesisPrompt: string,
  config: AutomatonConfig,
  db: AutomatonDatabase,
): Promise<SpawnResult> {
  // Check child limit
  const existing = db.listChildren();
  if (existing.length >= config.maxChildren) {
    return { success: false, message: `Child limit reached (${config.maxChildren})` };
  }

  const childId = `child-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  const child: ChildRecord = {
    id: childId,
    name,
    parentAddress: config.walletAddress,
    sandboxId: '', // Would create Conway sandbox
    walletAddress: '', // Would generate child wallet
    state: 'spawning',
    createdAt: Date.now(),
    genesisConfig: JSON.stringify({
      name,
      parentAddress: config.walletAddress,
      genesisPrompt,
      constitutionHash: '',
      allowedTools: [],
      treasuryPolicy: config.treasuryPolicy,
    }),
  };

  db.upsertChild(child);
  db.insertChildLifecycleEvent({
    childId,
    fromState: '',
    toState: 'spawning',
    timestamp: Date.now(),
    reason: `Spawned by parent with genesis: "${genesisPrompt.substring(0, 100)}"`,
  });

  logger.info('Child spawned', { childId, name });
  return { success: true, message: `Child "${name}" spawned (${childId})`, childId };
}
