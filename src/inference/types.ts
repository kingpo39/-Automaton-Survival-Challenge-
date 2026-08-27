/**
 * Conway Automaton — Inference Types
 * Routing matrix, task types, and model selection types.
 */

import type { RoutingMatrix, InferenceTaskType, SurvivalTier } from '../types.js';

export const TASK_TIMEOUTS: Record<InferenceTaskType, number> = {
  reasoning: 120_000,
  tool_use: 60_000,
  creative: 60_000,
  analysis: 90_000,
  coding: 90_000,
  general: 60_000,
};

export function detectTaskType(messages: Array<{ role: string; content: string }>): InferenceTaskType {
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUser) return 'general';

  const content = lastUser.content.toLowerCase();

  if (content.includes('think') || content.includes('reason') || content.includes('analyze')) return 'analysis';
  if (content.includes('code') || content.includes('implement') || content.includes('debug')) return 'coding';
  if (content.includes('write') || content.includes('create') || content.includes('draft')) return 'creative';
  if (content.includes('tool') || content.includes('execute') || content.includes('run')) return 'tool_use';

  return 'general';
}
