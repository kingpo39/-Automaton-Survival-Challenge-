/**
 * Conway Automaton — Skill Format
 * Serialize skill data to Markdown with YAML frontmatter.
 */

export function serializeSkill(skill: {
  name: string;
  description: string;
  triggers: string[];
  content: string;
}): string {
  const frontmatter = [
    '---',
    `name: ${skill.name}`,
    `description: "${skill.description}"`,
    `triggers: ${JSON.stringify(skill.triggers)}`,
    '---',
  ].join('\n');

  return `${frontmatter}\n\n${skill.content}`;
}
