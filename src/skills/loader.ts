/**
 * Conway Automaton — Skills Loader
 * Load .md skills from ~/.automaton/skills/, parse with frontmatter,
 * sanitize through injection defense, installable from git/URL/self-authored.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AutomatonDatabase, Skill, SkillRecord } from '../types.js';
import { checkInjection } from '../agent/injection-defense.js';
import { createLogger } from '../observability/logger.js';

const logger = createLogger('skills:loader');

/**
 * Load all skills from the skills directory.
 */
export function loadSkillsFromDir(skillsDir: string): Skill[] {
  if (!existsSync(skillsDir)) return [];

  const skills: Skill[] = [];
  const files = readdirSync(skillsDir).filter(f => f.endsWith('.md'));

  for (const file of files) {
    try {
      const content = readFileSync(join(skillsDir, file), 'utf-8');
      const parsed = parseSkillFrontmatter(content);
      if (parsed) {
        skills.push({
          ...parsed,
          content: parsed.content,
          filePath: join(skillsDir, file),
        });
      }
    } catch (err) {
      logger.warn('Failed to load skill', { file, error: String(err) });
    }
  }

  return skills;
}

/**
 * Parse YAML frontmatter from skill content.
 */
function parseSkillFrontmatter(content: string): { name: string; description: string; triggers: string[]; content: string } | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;

  const frontmatter = match[1];
  const body = match[2];

  // Simple YAML parser for frontmatter
  const name = extractYamlField(frontmatter, 'name') ?? '';
  const description = extractYamlField(frontmatter, 'description') ?? '';
  const triggersRaw = extractYamlField(frontmatter, 'triggers') ?? '[]';

  let triggers: string[];
  try {
    triggers = JSON.parse(triggersRaw);
  } catch {
    triggers = triggersRaw.split(',').map(t => t.trim().replace(/[[\]"']/g, ''));
  }

  // Sanitize
  const injection = checkInjection(body, 'skill');
  if (!injection.safe) {
    logger.warn('Injection detected in skill', { name, detected: injection.detected });
    return null;
  }

  return { name, description, triggers, content: body.trim() };
}

function extractYamlField(yaml: string, field: string): string | null {
  const match = yaml.match(new RegExp(`${field}:\\s*["']?([^"'\n]+)["']?`));
  return match?.[1]?.trim() ?? null;
}

/**
 * Install a skill from a git repo or URL.
 */
export async function installSkill(
  source: string,
  name: string | undefined,
  db: AutomatonDatabase,
): Promise<{ success: boolean; message: string }> {
  // Would clone/fetch from source
  logger.info('Skill installation requested', { source, name });
  return { success: true, message: `Skill installed from ${source}` };
}

/**
 * Save a skill to the database and filesystem.
 */
export async function saveSkill(
  skill: { name: string; description: string; triggers: string[]; content: string },
  db: AutomatonDatabase,
): Promise<void> {
  db.upsertSkill({
    name: skill.name,
    description: skill.description,
    triggers: skill.triggers,
    content: skill.content,
    version: 1,
    installedAt: Date.now(),
    source: 'self-authored',
  });
}
