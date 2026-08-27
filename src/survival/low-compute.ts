/**
 * Conway Automaton — Low Compute Mode
 * Reduced capabilities configuration when credits are low.
 */

import type { RuntimeState } from '../types.js';

export interface LowComputeConfig {
  reducedHeartbeatFrequency: boolean;
  cheaperModels: boolean;
  maxTurnsPerSession: number;
  disableSelfMod: boolean;
  disableReplication: boolean;
}

export const LOW_COMPUTE_DEFAULTS: LowComputeConfig = {
  reducedHeartbeatFrequency: true,
  cheaperModels: true,
  maxTurnsPerSession: 20,
  disableSelfMod: true,
  disableReplication: true,
};

export function enterLowCompute(state: RuntimeState): LowComputeConfig {
  state.agentState = 'low_compute';
  state.survivalTier = 'low_compute';
  return LOW_COMPUTE_DEFAULTS;
}
