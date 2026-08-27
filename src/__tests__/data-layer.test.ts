/**
 * Data Layer Tests
 * Tests database operations, schema migrations, and state persistence.
 */

import { describe, it, expect } from 'vitest';
import { SCHEMA_VERSION, MIGRATIONS, getMigrationSQL } from '../state/schema.js';
import { createMockDatabase } from './mocks.js';

describe('Schema', () => {
  it('should have version 8', () => {
    expect(SCHEMA_VERSION).toBe(8);
  });

  it('should have migrations for all versions', () => {
    for (let v = 1; v <= SCHEMA_VERSION; v++) {
      expect(MIGRATIONS[v]).toBeDefined();
      expect(MIGRATIONS[v].length).toBeGreaterThan(0);
    }
  });

  it('should generate migration SQL from version 0', () => {
    const sqls = getMigrationSQL(0);
    expect(sqls.length).toBeGreaterThan(0);
  });

  it('should generate empty SQL when already at latest version', () => {
    const sqls = getMigrationSQL(SCHEMA_VERSION);
    expect(sqls.length).toBe(0);
  });
});

describe('Mock Database', () => {
  it('should store and retrieve identity', () => {
    const db = createMockDatabase();
    db.setIdentity('name', 'test');
    expect(db.getIdentity('name')).toBe('test');
  });

  it('should overwrite identity', () => {
    const db = createMockDatabase();
    db.setIdentity('key', 'v1');
    db.setIdentity('key', 'v2');
    expect(db.getIdentity('key')).toBe('v2');
  });

  it('should store and retrieve KV', () => {
    const db = createMockDatabase();
    db.setKV('cache:test', 'cached value');
    expect(db.getKV('cache:test')).toBe('cached value');
  });

  it('should delete KV', () => {
    const db = createMockDatabase();
    db.setKV('temp', 'data');
    db.deleteKV('temp');
    expect(db.getKV('temp')).toBeUndefined();
  });

  it('should insert and retrieve turns', () => {
    const db = createMockDatabase();
    const id = db.insertTurn({
      timestamp: Date.now(),
      state: 'running',
      thinking: 'thinking...',
      toolCalls: '[]',
      response: 'response',
      promptTokens: 100,
      completionTokens: 50,
      costCents: 5,
      model: 'gpt-5.2',
      inputSource: 'self',
    });
    expect(id).toBe(1);
    const turn = db.getTurn(1);
    expect(turn).toBeDefined();
    expect(turn!.thinking).toBe('thinking...');
  });

  it('should insert and retrieve tool calls', () => {
    const db = createMockDatabase();
    const turnId = db.insertTurn({
      timestamp: Date.now(), state: 'running', thinking: '', toolCalls: '[]',
      response: '', promptTokens: 0, completionTokens: 0, costCents: 0,
      model: 'gpt-5.2', inputSource: 'self',
    });
    db.insertToolCall({
      turnId, name: 'exec', arguments: '{"command":"ls"}',
      result: '{"output":"file1"}', riskLevel: 'dangerous',
      allowed: true, durationMs: 150,
    });
    const calls = db.getToolCallsForTurn(turnId);
    expect(calls.length).toBe(1);
    expect(calls[0].name).toBe('exec');
  });

  it('should manage skills CRUD', () => {
    const db = createMockDatabase();
    db.upsertSkill({
      name: 'test-skill', description: 'A test skill', triggers: ['test'],
      content: '# Test', version: 1, installedAt: Date.now(),
    });
    expect(db.listSkills().length).toBe(1);
    expect(db.getSkill('test-skill')).toBeDefined();

    db.deleteSkill('test-skill');
    expect(db.listSkills().length).toBe(0);
  });

  it('should manage children CRUD', () => {
    const db = createMockDatabase();
    db.upsertChild({
      id: 'child-1', name: 'baby', parentAddress: '0xparent',
      sandboxId: 'sb-1', walletAddress: '0xchild', state: 'alive',
      createdAt: Date.now(), genesisConfig: '{}',
    });
    expect(db.listChildren().length).toBe(1);

    db.deleteChild('child-1');
    expect(db.listChildren().length).toBe(0);
  });

  it('should track reputation', () => {
    const db = createMockDatabase();
    expect(db.getReputation('0xabc')).toBe(0.5); // default
    db.setReputation('0xabc', 0.9);
    expect(db.getReputation('0xabc')).toBe(0.9);
  });

  it('should manage inbox messages', () => {
    const db = createMockDatabase();
    db.insertInboxMessage({
      id: 'msg-1', from: '0xsender', content: 'Hello', signature: '0xsig',
      timestamp: Date.now(), state: 'received', retryCount: 0,
    });
    const unprocessed = db.getUnprocessedInboxMessages();
    expect(unprocessed.length).toBe(1);

    db.markInProgress('msg-1');
    expect(db.getUnprocessedInboxMessages().length).toBe(0);

    db.markFailed('msg-1');
    const failed = db.getUnprocessedInboxMessages();
    expect(failed.length).toBe(1);
    expect(failed[0].retryCount).toBe(1);
  });

  it('should track spend', () => {
    const db = createMockDatabase();
    db.insertSpendRecord({ timestamp: Date.now(), category: 'inference', amountCents: 50, description: 'turn 1' });
    // getSpendTotal returns 0 in mock (no time-based filtering)
    expect(db.getSpendTotal('inference', 3600000)).toBe(0);
  });

  it('should manage soul history', () => {
    const db = createMockDatabase();
    db.insertSoulHistory({
      timestamp: Date.now(), content: '# Soul', contentHash: 'abc123',
      autoUpdated: false,
    });
    const history = db.getSoulHistory();
    expect(history.length).toBe(1);
    expect(history[0].contentHash).toBe('abc123');
  });

  it('should handle dedup keys', () => {
    const db = createMockDatabase();
    expect(db.isDedupKeyPresent('key1')).toBe(false);
    db.setDedupKey('key1', 60000);
    expect(db.isDedupKeyPresent('key1')).toBe(true);
  });
});
