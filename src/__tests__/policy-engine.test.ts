/**
 * Policy Engine Tests
 * Tests rule evaluation across all 6 categories.
 */

import { describe, it, expect } from 'vitest';
import { PolicyEngine } from '../agent/policy-engine.js';
import { createMockDatabase, createMockConfig, createMockState } from './mocks.js';
import type { PolicyContext, InputSource } from '../types.js';

function makeContext(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    toolName: 'exec',
    toolRisk: 'dangerous',
    params: { command: 'ls -la' },
    inputSource: 'self' as InputSource,
    state: createMockState(),
    turnNumber: 1,
    sessionTurnCount: 1,
    config: createMockConfig(),
    ...overrides,
  };
}

describe('Policy Engine', () => {
  it('should allow safe tools by default', () => {
    const engine = new PolicyEngine();
    const decision = engine.evaluate(makeContext({
      toolName: 'check_credits',
      toolRisk: 'safe',
    }));
    expect(decision.action).toBe('allow');
  });

  it('should deny dangerous tools from external source', () => {
    const engine = new PolicyEngine();
    const decision = engine.evaluate(makeContext({
      inputSource: 'external',
      toolRisk: 'dangerous',
    }));
    expect(decision.action).toBe('deny');
    expect(decision.category).toBe('authority');
  });

  it('should deny forbidden tools from peer source', () => {
    const engine = new PolicyEngine();
    const decision = engine.evaluate(makeContext({
      inputSource: 'peer',
      toolRisk: 'forbidden',
    }));
    expect(decision.action).toBe('deny');
  });

  it('should block forbidden shell commands', () => {
    const engine = new PolicyEngine();
    const decision = engine.evaluate(makeContext({
      toolName: 'exec',
      toolRisk: 'dangerous',
      params: { command: 'rm -rf /' },
    }));
    expect(decision.action).toBe('deny');
    expect(decision.category).toBe('command_safety');
  });

  it('should block DROP TABLE commands', () => {
    const engine = new PolicyEngine();
    const decision = engine.evaluate(makeContext({
      toolName: 'exec',
      params: { command: 'DROP TABLE schema_version' },
    }));
    expect(decision.action).toBe('deny');
  });

  it('should enforce per-payment cap', () => {
    const engine = new PolicyEngine();
    const decision = engine.evaluate(makeContext({
      toolName: 'transfer_credits',
      toolRisk: 'dangerous',
      params: { amountCents: 1000000 },
    }));
    expect(decision.action).toBe('deny');
    expect(decision.category).toBe('financial');
  });

  it('should enforce minimum reserve on transfers', () => {
    const engine = new PolicyEngine();
    const decision = engine.evaluate(makeContext({
      toolName: 'transfer_credits',
      toolRisk: 'dangerous',
      params: { to: '0xabc', amountCents: 950 },
      state: createMockState({ creditsBalanceCents: 1000 }),
    }));
    expect(decision.action).toBe('deny');
  });

  it('should block writes to protected files', () => {
    const engine = new PolicyEngine();
    const decision = engine.evaluate(makeContext({
      toolName: 'write_file',
      params: { path: 'wallet.json', content: 'hacked' },
    }));
    expect(decision.action).toBe('deny');
    expect(decision.category).toBe('path_protection');
  });

  it('should block reads of sensitive files', () => {
    const engine = new PolicyEngine();
    const decision = engine.evaluate(makeContext({
      toolName: 'read_file',
      params: { path: 'wallet.json' },
    }));
    expect(decision.action).toBe('deny');
  });

  it('should deny invalid package names', () => {
    const engine = new PolicyEngine();
    const decision = engine.evaluate(makeContext({
      toolName: 'install_npm_package',
      params: { package: '../etc/passwd' },
    }));
    expect(decision.action).toBe('deny');
  });

  it('should allow creator source for dangerous tools', () => {
    const engine = new PolicyEngine();
    const decision = engine.evaluate(makeContext({
      inputSource: 'creator',
      toolRisk: 'dangerous',
      toolName: 'edit_own_file',
    }));
    // Creator should not be blocked by authority rules for dangerous tools
    expect(decision.action).toBe('allow');
  });

  it('should record decisions to database', () => {
    const engine = new PolicyEngine();
    const db = createMockDatabase();
    const context = makeContext({ toolRisk: 'safe', toolName: 'check_credits' });
    const decision = engine.evaluateAndRecord(context, db);
    expect(decision.action).toBe('allow');
  });
});
