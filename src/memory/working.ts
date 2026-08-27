/**
 * Conway Automaton — Working Memory
 * Session-scoped short-term memory for goals, observations, plans, reflections.
 */

import type { AutomatonDatabase, WorkingMemoryRecord } from '../types.js';

export function addWorkingMemory(db: AutomatonDatabase, key: string, value: string, category = 'general', ttlMs?: number): void {
  db.insertWorkingMemory({
    key,
    value,
    category,
    createdAt: Date.now(),
    expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
  });
}

export function getWorkingMemory(db: AutomatonDatabase): WorkingMemoryRecord[] {
  return db.getWorkingMemory();
}

export function clearWorkingMemory(db: AutomatonDatabase): void {
  db.clearWorkingMemory();
}
