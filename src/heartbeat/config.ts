/**
 * Conway Automaton — Heartbeat Config
 * Load/save/merge heartbeat.yml configuration.
 */

import type { HeartbeatConfig } from '../types.js';

export function getDefaultHeartbeatConfig(): HeartbeatConfig {
  return {
    tickIntervalMs: 60_000,
    maxConcurrentTasks: 3,
    tasks: [],
  };
}

export function mergeHeartbeatConfig(
  defaults: HeartbeatConfig,
  overrides: Partial<HeartbeatConfig>,
): HeartbeatConfig {
  return { ...defaults, ...overrides };
}
