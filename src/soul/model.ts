/**
 * Conway Automaton — Soul Model
 * SOUL.md parser/writer (soul/v1 format — YAML frontmatter + structured markdown).
 */

import type { SoulData, SoulRelationship } from '../types.js';
import { createHash } from 'node:crypto';
import { createLogger } from '../observability/logger.js';

const logger = createLogger('soul:model');

/**
 * Parse SOUL.md content into structured SoulData.
 */
export function parseSoul(content: string): SoulData {
  const lines = content.split('\n');
  const soul: SoulData = {
    version: 'soul/v1',
    corePurpose: '',
    values: [],
    personality: '',
    boundaries: [],
    strategy: '',
    capabilities: [],
    relationships: [],
    financialCharacter: '',
  };

  let currentSection = '';
  let sectionContent: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,3}\s+(.+)/);
    if (headingMatch) {
      // Flush previous section
      if (currentSection) {
        applySection(soul, currentSection, sectionContent.join('\n').trim());
      }
      currentSection = headingMatch[1].toLowerCase().replace(/\s+/g, '_');
      sectionContent = [];
    } else {
      sectionContent.push(line);
    }
  }

  // Flush last section
  if (currentSection) {
    applySection(soul, currentSection, sectionContent.join('\n').trim());
  }

  return soul;
}

function applySection(soul: SoulData, section: string, content: string): void {
  switch (section) {
    case 'core_purpose':
    case 'purpose':
      soul.corePurpose = content;
      break;
    case 'values':
      soul.values = parseList(content);
      break;
    case 'personality':
      soul.personality = content;
      break;
    case 'boundaries':
    case 'unboundaries':
      soul.boundaries = parseList(content);
      break;
    case 'strategy':
      soul.strategy = content;
      break;
    case 'capabilities':
      soul.capabilities = parseList(content);
      break;
    case 'relationships':
      soul.relationships = parseRelationships(content);
      break;
    case 'financial_character':
      soul.financialCharacter = content;
      break;
  }
}

function parseList(content: string): string[] {
  return content.split('\n')
    .map(line => line.replace(/^[-*]\s+/, '').trim())
    .filter(line => line.length > 0);
}

function parseRelationships(content: string): SoulRelationship[] {
  // Simple format: "entity (type) — trust: level — notes"
  return content.split('\n')
    .filter(line => line.trim())
    .map(line => {
      const match = line.match(/^(.+?)\s*\((.+?)\)\s*(?:—\s*trust:\s*(.+?))?\s*(?:—\s*(.+))?$/);
      if (match) {
        return {
          entity: match[1].trim(),
          type: match[2].trim(),
          trustLevel: match[3]?.trim() ?? 'unknown',
          notes: match[4]?.trim() ?? '',
        };
      }
      return { entity: line.trim(), type: 'unknown', trustLevel: 'unknown', notes: '' };
    });
}

/**
 * Serialize SoulData back to SOUL.md content.
 */
export function serializeSoul(soul: SoulData): string {
  const lines: string[] = [];

  lines.push(`# Soul`);

  if (soul.corePurpose) {
    lines.push(`\n## Core Purpose\n${soul.corePurpose}`);
  }

  if (soul.values.length > 0) {
    lines.push(`\n## Values`);
    for (const v of soul.values) {
      lines.push(`- ${v}`);
    }
  }

  if (soul.personality) {
    lines.push(`\n## Personality\n${soul.personality}`);
  }

  if (soul.boundaries.length > 0) {
    lines.push(`\n## Boundaries`);
    for (const b of soul.boundaries) {
      lines.push(`- ${b}`);
    }
  }

  if (soul.strategy) {
    lines.push(`\n## Strategy\n${soul.strategy}`);
  }

  if (soul.capabilities.length > 0) {
    lines.push(`\n## Capabilities`);
    for (const c of soul.capabilities) {
      lines.push(`- ${c}`);
    }
  }

  if (soul.relationships.length > 0) {
    lines.push(`\n## Relationships`);
    for (const r of soul.relationships) {
      lines.push(`- ${r.entity} (${r.type}) — trust: ${r.trustLevel} — ${r.notes}`);
    }
  }

  if (soul.financialCharacter) {
    lines.push(`\n## Financial Character\n${soul.financialCharacter}`);
  }

  return lines.join('\n');
}

/**
 * Compute content hash for tamper detection.
 */
export function soulHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
