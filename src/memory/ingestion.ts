/**
 * Conway Automaton — Memory Ingestion
 * Post-turn pipeline that extracts episodic events, semantic facts,
 * and procedural outcomes from completed turns.
 */

import type { AutomatonDatabase } from '../types.js';
import { classifyTurn, calculateImportance } from './types.js';
import { createLogger } from '../observability/logger.js';

const logger = createLogger('memory:ingestion');

export interface IngestionInput {
  turnId: number;
  toolCalls: Array<{ name: string; result: { success: boolean; output: string } }>;
  response: string;
  hasExternalInput: boolean;
}

export function ingestTurn(db: AutomatonDatabase, input: IngestionInput): void {
  const classification = classifyTurn(input.toolCalls, input.response, input.hasExternalInput);
  const importance = calculateImportance(classification);

  // Record episodic memory for significant turns
  if (classification !== 'idle') {
    const event = buildEventDescription(input, classification);
    db.insertEpisodicMemory({
      timestamp: Date.now(),
      event,
      classification,
      importance,
      turnId: input.turnId,
      metadata: JSON.stringify({
        toolCalls: input.toolCalls.map(tc => tc.name),
        responseLength: input.response.length,
      }),
    });
  }

  // Extract semantic facts from tool outputs
  for (const tc of input.toolCalls) {
    if (tc.result.success && tc.result.output) {
      const fact = extractFact(tc.name, tc.result.output);
      if (fact) {
        db.insertSemanticMemory({
          category: fact.category,
          key: fact.key,
          value: fact.value,
          confidence: 0.9,
          source: 'ingestion',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
    }
  }

  // Track procedure outcomes
  const procedureTools = ['exec', 'git_commit', 'install_npm_package'];
  for (const tc of input.toolCalls) {
    if (procedureTools.includes(tc.name)) {
      const procedures = db.getProceduralMemory();
      const existing = procedures.find(p => p.name === tc.name);
      if (existing) {
        db.insertProceduralMemory({
          ...existing,
          successCount: existing.successCount + (tc.result.success ? 1 : 0),
          failCount: existing.failCount + (tc.result.success ? 0 : 1),
          lastUsed: Date.now(),
        });
      }
    }
  }

  logger.debug('Turn ingested', { turnId: input.turnId, classification, importance });
}

function buildEventDescription(input: IngestionInput, classification: string): string {
  const toolNames = input.toolCalls.map(tc => tc.name).join(', ');
  return `[${classification}] Tools: ${toolNames || 'none'}. Response: ${input.response.substring(0, 200)}`;
}

interface ExtractedFact {
  category: string;
  key: string;
  value: string;
}

function extractFact(toolName: string, output: string): ExtractedFact | null {
  // Extract balance facts
  if (toolName === 'check_credits') {
    const match = output.match(/\$([\d.]+)/);
    if (match) return { category: 'financial', key: 'credits_balance', value: match[1] };
  }
  if (toolName === 'check_usdc_balance') {
    const match = output.match(/\$([\d.]+)/);
    if (match) return { category: 'financial', key: 'usdc_balance', value: match[1] };
  }

  // Extract identity facts
  if (toolName === 'system_synopsis') {
    return { category: 'environment', key: 'last_synopsis', value: output.substring(0, 500) };
  }

  return null;
}
