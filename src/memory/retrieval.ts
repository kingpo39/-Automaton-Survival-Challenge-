/**
 * Conway Automaton — Memory Retrieval
 * Cross-tier retrieval within token budget.
 * Priority: working > episodic > semantic > procedural > relationships.
 */

import type { AutomatonDatabase } from '../types.js';
import { allocateBudget } from './budget.js';

export interface MemoryRetrievalResult {
  block: string;
  tokensUsed: number;
}

export function retrieveMemories(db: AutomatonDatabase, maxTokens?: number): MemoryRetrievalResult {
  const budget = allocateBudget(maxTokens);
  const sections: string[] = [];
  let tokensUsed = 0;

  // Working memory (highest priority)
  const working = db.getWorkingMemory();
  const workingText = working.map(w => `[${w.category}] ${w.key}: ${w.value}`).join('\n');
  if (workingText && tokensUsed + estimateTokens(workingText) <= budget.working) {
    sections.push(`## Working Memory\n${workingText}`);
    tokensUsed += estimateTokens(workingText);
  }

  // Episodic memory
  const episodic = db.getEpisodicMemory(10);
  const episodicText = episodic.map(e =>
    `[${new Date(e.timestamp).toISOString()}] (${e.classification}/${e.importance}) ${e.event}`
  ).join('\n');
  if (episodicText && tokensUsed + estimateTokens(episodicText) <= budget.episodic) {
    sections.push(`## Recent Events\n${episodicText}`);
    tokensUsed += estimateTokens(episodicText);
  }

  // Semantic memory
  const semantic = db.getSemanticMemory();
  const semanticText = semantic.map(s => `[${s.category}] ${s.key}: ${s.value}`).join('\n');
  if (semanticText && tokensUsed + estimateTokens(semanticText) <= budget.semantic) {
    sections.push(`## Known Facts\n${semanticText}`);
    tokensUsed += estimateTokens(semanticText);
  }

  // Procedural memory
  const procedural = db.getProceduralMemory();
  const proceduralText = procedural.map(p =>
    `${p.name} (success: ${p.successCount}, fail: ${p.failCount})`
  ).join('\n');
  if (proceduralText && tokensUsed + estimateTokens(proceduralText) <= budget.procedural) {
    sections.push(`## Procedures\n${proceduralText}`);
    tokensUsed += estimateTokens(proceduralText);
  }

  // Relationships
  // Would need a method to get all relationships
  const block = sections.length > 0 ? sections.join('\n\n') : '';

  return { block, tokensUsed };
}

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.split(/\s+/).length / 0.75);
}
