/**
 * Skills Tests
 * Tests skill loading, frontmatter, and format.
 */

import { describe, it, expect } from 'vitest';
import { serializeSkill } from '../skills/format.js';
import { createMockDatabase } from './mocks.js';

describe('Skill Format', () => {
  it('should serialize skill to markdown with frontmatter', () => {
    const result = serializeSkill({
      name: 'my-skill',
      description: 'A helpful skill',
      triggers: ['help', 'assist'],
      content: '# Instructions\nDo things.',
    });
    expect(result).toContain('---');
    expect(result).toContain('name: my-skill');
    expect(result).toContain('description: "A helpful skill"');
    expect(result).toContain('triggers: ["help","assist"]');
    expect(result).toContain('# Instructions');
  });

  it('should handle empty triggers', () => {
    const result = serializeSkill({
      name: 'test',
      description: 'test',
      triggers: [],
      content: 'content',
    });
    expect(result).toContain('triggers: []');
  });
});

describe('Skill Database', () => {
  it('should manage skills CRUD via DB', () => {
    const db = createMockDatabase();
    db.upsertSkill({
      name: 'test-skill', description: 'test', triggers: ['t1'],
      content: 'content', version: 1, installedAt: Date.now(), source: 'self',
    });
    expect(db.listSkills().length).toBe(1);

    const skill = db.getSkill('test-skill');
    expect(skill).toBeDefined();
    expect(skill!.content).toBe('content');

    db.deleteSkill('test-skill');
    expect(db.listSkills().length).toBe(0);
  });
});
