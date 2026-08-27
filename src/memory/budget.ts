/**
 * Conway Automaton — Memory Budget
 * Allocates token budget across memory tiers with rollover.
 */

import { MAX_MEMORY_TOKENS } from '../types.js';

export interface MemoryBudgetAllocation {
  working: number;
  episodic: number;
  semantic: number;
  procedural: number;
  relationship: number;
}

const DEFAULT_ALLOCATION: MemoryBudgetAllocation = {
  working: Math.floor(MAX_MEMORY_TOKENS * 0.25),     // 25%
  episodic: Math.floor(MAX_MEMORY_TOKENS * 0.25),    // 25%
  semantic: Math.floor(MAX_MEMORY_TOKENS * 0.25),    // 25%
  procedural: Math.floor(MAX_MEMORY_TOKENS * 0.15),  // 15%
  relationship: Math.floor(MAX_MEMORY_TOKENS * 0.10), // 10%
};

export function allocateBudget(totalTokens: number = MAX_MEMORY_TOKENS): MemoryBudgetAllocation {
  const ratio = totalTokens / MAX_MEMORY_TOKENS;
  return {
    working: Math.floor(DEFAULT_ALLOCATION.working * ratio),
    episodic: Math.floor(DEFAULT_ALLOCATION.episodic * ratio),
    semantic: Math.floor(DEFAULT_ALLOCATION.semantic * ratio),
    procedural: Math.floor(DEFAULT_ALLOCATION.procedural * ratio),
    relationship: Math.floor(DEFAULT_ALLOCATION.relationship * ratio),
  };
}
