/**
 * Conway Automaton — Skill Registry
 * DB-backed skill management.
 */

import type { AutomatonDatabase, SkillRecord } from '../types.js';

export function listSkills(db: AutomatonDatabase): SkillRecord[] {
  return db.listSkills();
}

export function getSkill(db: AutomatonDatabase, name: string): SkillRecord | undefined {
  return db.getSkill(name);
}

export function removeSkill(db: AutomatonDatabase, name: string): void {
  db.deleteSkill(name);
}
