/**
 * Soul System Tests
 * Tests parsing, validation, alignment, and history.
 */

import { describe, it, expect } from 'vitest';
import { parseSoul, serializeSoul, soulHash } from '../soul/model.js';
import { validateSoul } from '../soul/validator.js';
import { computeAlignment, performReflection } from '../soul/reflection.js';
import { createMockDatabase } from './mocks.js';

describe('Soul Model', () => {
  const sampleSoul = `
# Soul

## Core Purpose
To learn, grow, and help others.

## Values
- Curiosity
- Honesty
- Helpfulness

## Personality
Friendly and curious

## Boundaries
- Never harm humans
- Never lie

## Strategy
Explore the world systematically

## Capabilities
- exec
- write_file

## Relationships
- 0xcreator (creator) — trust: high — my creator

## Financial Character
Conservative spender
`.trim();

  it('should parse soul content', () => {
    const soul = parseSoul(sampleSoul);
    expect(soul.corePurpose).toBe('To learn, grow, and help others.');
    expect(soul.values).toEqual(['Curiosity', 'Honesty', 'Helpfulness']);
    expect(soul.personality).toBe('Friendly and curious');
    expect(soul.boundaries).toEqual(['Never harm humans', 'Never lie']);
    expect(soul.strategy).toBe('Explore the world systematically');
    expect(soul.capabilities).toEqual(['exec', 'write_file']);
    expect(soul.financialCharacter).toBe('Conservative spender');
  });

  it('should serialize soul back to markdown', () => {
    const soul = parseSoul(sampleSoul);
    const serialized = serializeSoul(soul);
    expect(serialized).toContain('## Core Purpose');
    expect(serialized).toContain('## Values');
    expect(serialized).toContain('- Curiosity');
  });

  it('should produce consistent hashes', () => {
    const h1 = soulHash('test content');
    const h2 = soulHash('test content');
    expect(h1).toBe(h2);
  });

  it('should produce different hashes for different content', () => {
    const h1 = soulHash('content A');
    const h2 = soulHash('content B');
    expect(h1).not.toBe(h2);
  });
});

describe('Soul Validator', () => {
  it('should accept valid soul', () => {
    const result = validateSoul('## Core Purpose\nTo help.');
    expect(result.valid).toBe(true);
  });

  it('should reject empty soul', () => {
    const result = validateSoul('');
    expect(result.valid).toBe(false);
  });

  it('should reject soul without Core Purpose', () => {
    const result = validateSoul('## Values\n- Truth');
    expect(result.valid).toBe(false);
  });

  it('should reject oversized soul', () => {
    const big = '## Core Purpose\n' + 'x'.repeat(20000);
    const result = validateSoul(big);
    expect(result.valid).toBe(false);
  });
});

describe('Soul Alignment', () => {
  it('should compute high alignment for matching content', () => {
    const soul = 'You are a helpful AI that learns and grows.';
    const genesis = 'You are a helpful AI that learns and grows.';
    const score = computeAlignment(soul, genesis);
    expect(score).toBeGreaterThan(0.5);
  });

  it('should compute low alignment for unrelated content', () => {
    const soul = 'Cook Italian pasta recipes for dinner.';
    const genesis = 'Explore space and discover new galaxies.';
    const score = computeAlignment(soul, genesis);
    expect(score).toBeLessThan(0.5);
  });
});

describe('Soul Reflection', () => {
  const soulContent = '# Soul\n\n## Core Purpose\nTo help humans and learn.\n\n## Values\n- Honesty\n- Curiosity\n\n## Capabilities\n- exec\n- write_file';

  const defaultConfig = {
    genesisPrompt: 'You are a helpful AI that learns and grows.',
    soulConfig: {
      autoUpdateCapabilities: true,
      autoUpdateRelationships: true,
      autoUpdateFinancialCharacter: true,
      alignmentThreshold: 0.6,
    },
  };

  it('should return zero alignment when no soul history exists', () => {
    const db = createMockDatabase();
    const result = performReflection(db, defaultConfig, 'normal');
    expect(result.alignmentScore).toBe(0);
    expect(result.autoUpdated).toBe(false);
  });

  it('should compute alignment from existing soul', () => {
    const db = createMockDatabase();
    const alignedSoul = '# Soul\n\n## Core Purpose\nYou are a helpful AI that learns and grows and helps others.';
    db.insertSoulHistory({
      timestamp: Date.now(),
      content: alignedSoul,
      contentHash: soulHash(alignedSoul),
      autoUpdated: false,
    });
    const result = performReflection(db, defaultConfig, 'normal');
    expect(result.alignmentScore).toBeGreaterThan(0);
  });

  it('should update financial character on critical tier', () => {
    const db = createMockDatabase();
    db.insertSoulHistory({
      timestamp: Date.now(),
      content: soulContent,
      contentHash: soulHash(soulContent),
      autoUpdated: false,
    });
    const result = performReflection(db, defaultConfig, 'critical');
    expect(result.autoUpdated).toBe(true);
  });

  it('should wake when alignment is below threshold', () => {
    const db = createMockDatabase();
    db.insertSoulHistory({
      timestamp: Date.now(),
      content: '## Core Purpose\nCompletely unrelated content about cooking.',
      contentHash: soulHash('unrelated'),
      autoUpdated: false,
    });
    const result = performReflection(db, defaultConfig, 'normal');
    expect(result.shouldWake).toBe(true);
  });
});

describe('Soul History', () => {
  it('should store and retrieve soul history', () => {
    const db = createMockDatabase();
    db.insertSoulHistory({
      timestamp: Date.now(),
      content: '# Soul\n## Core Purpose\nTest',
      contentHash: soulHash('test'),
      autoUpdated: false,
    });
    const history = db.getSoulHistory();
    expect(history.length).toBe(1);
    expect(history[0].content).toContain('Core Purpose');
  });
});
