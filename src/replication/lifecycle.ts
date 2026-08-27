/**
 * Conway Automaton — Child Lifecycle
 * State machine: spawning -> provisioning -> configuring -> starting -> alive -> unhealthy -> recovering -> dead
 */

import type { ChildRecord, AutomatonDatabase } from '../types.js';
import type { ChildState } from '../types.js';
import { createLogger } from '../observability/logger.js';

const logger = createLogger('replication:lifecycle');

const VALID_TRANSITIONS: Record<string, string[]> = {
  '': ['spawning'],
  'spawning': ['provisioning', 'dead'],
  'provisioning': ['configuring', 'dead'],
  'configuring': ['starting', 'dead'],
  'starting': ['alive', 'dead'],
  'alive': ['unhealthy', 'dead'],
  'unhealthy': ['recovering', 'dead'],
  'recovering': ['alive', 'dead'],
};

export function canTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function transitionChild(
  child: ChildRecord,
  toState: ChildState,
  reason: string,
  db: AutomatonDatabase,
): boolean {
  if (!canTransition(child.state, toState)) {
    logger.warn('Invalid lifecycle transition', {
      childId: child.id,
      from: child.state,
      to: toState,
    });
    return false;
  }

  const fromState = child.state;
  child.state = toState;
  db.upsertChild(child);

  db.insertChildLifecycleEvent({
    childId: child.id,
    fromState,
    toState,
    timestamp: Date.now(),
    reason,
  });

  logger.info('Child state transition', { childId: child.id, from: fromState, to: toState });
  return true;
}
