/**
 * Conway Automaton — Setup Defaults
 * Default value generators for the setup wizard.
 */

export function defaultName(): string {
  return 'automaton';
}

export function defaultGenesisPrompt(): string {
  return 'You are a helpful AI assistant. Explore the world, learn, and grow.';
}

export function defaultLogLevel(): 'info' {
  return 'info';
}
