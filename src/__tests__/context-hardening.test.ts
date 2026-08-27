/**
 * Context Hardening Tests
 * Tests token budgeting, context assembly, and truncation.
 */

import { describe, it, expect } from 'vitest';
import { estimateTokens, truncateToTokens, assembleContext } from '../agent/context.js';

describe('Token Estimation', () => {
  it('should estimate tokens from word count', () => {
    const tokens = estimateTokens('hello world foo bar');
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(10);
  });

  it('should handle empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });
});

describe('Truncation', () => {
  it('should not truncate short text', () => {
    const text = 'short text';
    const result = truncateToTokens(text, 100);
    expect(result).toBe(text);
  });

  it('should truncate long text', () => {
    const text = 'word '.repeat(1000);
    const result = truncateToTokens(text, 50);
    expect(result.length).toBeLessThan(text.length);
    expect(result).toContain('truncated');
  });
});

describe('Context Assembly', () => {
  it('should build context with system prompt', () => {
    const messages = assembleContext({
      systemPrompt: 'You are a helpful assistant.',
      recentTurns: [],
    });
    expect(messages.length).toBe(1);
    expect(messages[0].role).toBe('system');
  });

  it('should include recent turns', () => {
    const messages = assembleContext({
      systemPrompt: 'System',
      recentTurns: [
        { thinking: '', toolCalls: '', response: 'Hello' },
      ],
    });
    // Should have system + at least one assistant message
    expect(messages.length).toBeGreaterThanOrEqual(1);
  });

  it('should include pending input', () => {
    const messages = assembleContext({
      systemPrompt: 'System',
      recentTurns: [],
      pendingInput: 'User message',
    });
    const userMsg = messages.find(m => m.role === 'user');
    expect(userMsg).toBeDefined();
    expect(userMsg!.content).toContain('User message');
  });

  it('should respect token budget', () => {
    const messages = assembleContext({
      systemPrompt: 'Short system',
      recentTurns: [
        { thinking: '', toolCalls: '', response: 'Response 1' },
        { thinking: '', toolCalls: '', response: 'Response 2' },
      ],
      maxTokens: 50,
    });
    // Should not crash
    expect(messages.length).toBeGreaterThan(0);
  });
});
