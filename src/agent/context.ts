/**
 * Conway Automaton — Context Assembly
 * Builds inference messages within token budget. Manages context window.
 */

import type { ChatMessage, AutomatonConfig, RuntimeState } from '../types.js';
import { MAX_CONTEXT_TOKENS, MAX_SYSTEM_PROMPT_TOKENS } from '../types.js';
import { createLogger } from '../observability/logger.js';

const logger = createLogger('agent:context');

/**
 * Approximate token count (words / 0.75 for English text).
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const words = text.split(/\s+/).length;
  return Math.ceil(words / 0.75);
}

/**
 * Truncate text to fit within a token budget.
 * Keeps the beginning and end, truncating the middle.
 */
export function truncateToTokens(text: string, maxTokens: number): string {
  const currentTokens = estimateTokens(text);
  if (currentTokens <= maxTokens) return text;

  // Keep ~60% from start, 40% from end
  const words = text.split(/\s+/);
  const keepStart = Math.floor(words.length * 0.6);
  const keepEnd = words.length - keepStart;

  const targetWords = Math.floor(maxTokens * 0.75);
  const startWords = Math.floor(targetWords * 0.6);
  const endWords = targetWords - startWords;

  const start = words.slice(0, startWords).join(' ');
  const end = words.slice(-endWords).join(' ');

  return `${start}\n\n[... truncated ...]\n\n${end}`;
}

export interface ContextAssemblyOptions {
  systemPrompt: string;
  recentTurns: Array<{ thinking: string; toolCalls: string; response: string }>;
  pendingInput?: string;
  maxTokens?: number;
}

/**
 * Assemble the full context messages for an inference call.
 * Respects token budgets: system prompt + recent turns + pending input.
 */
export function assembleContext(options: ContextAssemblyOptions): ChatMessage[] {
  const maxTokens = options.maxTokens ?? MAX_CONTEXT_TOKENS;
  const systemPrompt = truncateToTokens(options.systemPrompt, MAX_SYSTEM_PROMPT_TOKENS);
  const systemTokens = estimateTokens(systemPrompt);

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
  ];

  let usedTokens = systemTokens;
  const availableForHistory = maxTokens - systemTokens - 1000; // Reserve 1000 for response

  // Add recent turns from newest to oldest until budget is hit
  const turnsToAdd: typeof options.recentTurns = [];
  for (const turn of [...options.recentTurns].reverse()) {
    const turnText = `${turn.thinking}\n${turn.toolCalls}\n${turn.response}`;
    const turnTokens = estimateTokens(turnText);
    if (usedTokens + turnTokens > maxTokens - 1000) break;
    turnsToAdd.unshift(turn);
    usedTokens += turnTokens;
  }

  // Add turns as alternating user/assistant messages
  for (const turn of turnsToAdd) {
    if (turn.response) {
      // Ensure we never have 2 consecutive assistant messages (Ollama rejects this)
      const lastMsg = messages[messages.length - 1];
      if (lastMsg?.role === 'assistant') {
        messages.push({ role: 'user', content: '(continuing)' });
      }
      messages.push({ role: 'assistant', content: turn.response });
    }
  }

  // Add pending input
  if (options.pendingInput) {
    const inputTokens = estimateTokens(options.pendingInput);
    if (usedTokens + inputTokens < maxTokens) {
      // Ensure last message is not assistant before adding user
      const lastMsg = messages[messages.length - 1];
      if (lastMsg?.role === 'assistant') {
        messages.push({ role: 'user', content: options.pendingInput });
      } else {
        messages.push({ role: 'user', content: options.pendingInput });
      }
    } else {
      const truncated = truncateToTokens(options.pendingInput, maxTokens - usedTokens - 100);
      messages.push({ role: 'user', content: truncated });
    }
  }

  logger.debug('Context assembled', {
    messageCount: messages.length,
    estimatedTokens: estimateTokens(messages.map(m => m.content).join(' ')),
  });

  return messages;
}
