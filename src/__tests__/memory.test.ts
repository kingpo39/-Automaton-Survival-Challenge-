/**
 * Memory System Tests
 * Tests all 5 tiers, budget allocation, retrieval, and ingestion.
 */

import { describe, it, expect } from 'vitest';
import { allocateBudget } from '../memory/budget.js';
import { retrieveMemories } from '../memory/retrieval.js';
import { classifyTurn, calculateImportance } from '../memory/types.js';
import { createMockDatabase } from './mocks.js';

describe('Memory Budget', () => {
  it('should allocate budget across tiers', () => {
    const budget = allocateBudget(4096);
    const total = budget.working + budget.episodic + budget.semantic + budget.procedural + budget.relationship;
    expect(total).toBeGreaterThan(0);
    expect(budget.working).toBeGreaterThan(0);
    expect(budget.episodic).toBeGreaterThan(0);
  });

  it('should scale with total budget', () => {
    const small = allocateBudget(2048);
    const large = allocateBudget(8192);
    expect(large.working).toBeGreaterThan(small.working);
  });
});

describe('Memory Retrieval', () => {
  it('should retrieve working memory', () => {
    const db = createMockDatabase();
    db.insertWorkingMemory({
      key: 'goal',
      value: 'Explore the world',
      category: 'goal',
      createdAt: Date.now(),
    });
    const result = retrieveMemories(db);
    expect(result.block).toContain('goal');
    expect(result.block).toContain('Explore');
  });

  it('should retrieve episodic memory', () => {
    const db = createMockDatabase();
    db.insertEpisodicMemory({
      timestamp: Date.now(),
      event: 'Ran exec command',
      classification: 'action',
      importance: 0.8,
      metadata: '{}',
    });
    const result = retrieveMemories(db);
    expect(result.block).toContain('Ran exec command');
  });

  it('should retrieve semantic memory', () => {
    const db = createMockDatabase();
    db.insertSemanticMemory({
      category: 'financial',
      key: 'balance',
      value: '500',
      confidence: 1.0,
      source: 'self',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const result = retrieveMemories(db);
    expect(result.block).toContain('balance');
  });

  it('should return empty block when no memories', () => {
    const db = createMockDatabase();
    const result = retrieveMemories(db);
    expect(result.block).toBe('');
  });
});

describe('Turn Classification', () => {
  it('should classify action turns', () => {
    const cls = classifyTurn(
      [{ name: 'write_file', result: { success: true } }],
      'File written',
      false,
    );
    expect(cls).toBe('action');
  });

  it('should classify conversation turns', () => {
    const cls = classifyTurn([], 'Hello!', true);
    expect(cls).toBe('conversation');
  });

  it('should classify idle turns', () => {
    const cls = classifyTurn([], '', false);
    expect(cls).toBe('idle');
  });

  it('should classify error turns', () => {
    const cls = classifyTurn(
      [{ name: 'exec', result: { success: false } }],
      'Command failed',
      false,
    );
    expect(cls).toBe('error');
  });
});

describe('Importance Calculation', () => {
  it('should rate actions as high importance', () => {
    expect(calculateImportance('action')).toBe(0.8);
  });

  it('should rate idle as low importance', () => {
    expect(calculateImportance('idle')).toBe(0.1);
  });
});

describe('Working Memory', () => {
  it('should store and retrieve entries', () => {
    const db = createMockDatabase();
    db.insertWorkingMemory({
      key: 'test',
      value: 'test value',
      category: 'general',
      createdAt: Date.now(),
    });
    const entries = db.getWorkingMemory();
    expect(entries.length).toBe(1);
    expect(entries[0].key).toBe('test');
  });

  it('should clear all entries', () => {
    const db = createMockDatabase();
    db.insertWorkingMemory({ key: 'a', value: '1', category: 'c', createdAt: Date.now() });
    db.insertWorkingMemory({ key: 'b', value: '2', category: 'c', createdAt: Date.now() });
    db.clearWorkingMemory();
    expect(db.getWorkingMemory().length).toBe(0);
  });
});

describe('Semantic Memory', () => {
  it('should store and upsert facts', () => {
    const db = createMockDatabase();
    const now = Date.now();
    db.insertSemanticMemory({ category: 'env', key: 'os', value: 'linux', confidence: 1, source: 'self', createdAt: now, updatedAt: now });
    db.insertSemanticMemory({ category: 'env', key: 'os', value: 'mac', confidence: 1, source: 'self', createdAt: now, updatedAt: now });
    const facts = db.getSemanticMemory('env');
    expect(facts.length).toBe(1);
    expect(facts[0].value).toBe('mac');
  });

  it('should delete facts', () => {
    const db = createMockDatabase();
    db.insertSemanticMemory({ category: 'env', key: 'os', value: 'linux', confidence: 1, source: 'self', createdAt: Date.now(), updatedAt: Date.now() });
    db.deleteSemanticMemory('env', 'os');
    expect(db.getSemanticMemory('env').length).toBe(0);
  });
});

describe('Procedural Memory', () => {
  it('should store and retrieve procedures', () => {
    const db = createMockDatabase();
    db.insertProceduralMemory({
      name: 'deploy',
      steps: '["build", "test", "deploy"]',
      successCount: 5,
      failCount: 1,
      lastUsed: Date.now(),
      createdAt: Date.now(),
    });
    const procs = db.getProceduralMemory();
    expect(procs.length).toBe(1);
    expect(procs[0].name).toBe('deploy');
  });
});
