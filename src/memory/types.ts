/**
 * Conway Automaton — Memory Types
 * Turn classification logic for memory extraction.
 */

export type TurnClassification =
  | 'action'        // Tool call with meaningful result
  | 'decision'      // Agent made a significant choice
  | 'observation'   // Agent noted something important
  | 'conversation'  // External message interaction
  | 'idle'          // No meaningful content
  | 'error';        // Something went wrong

export function classifyTurn(
  toolCalls: Array<{ name: string; result: { success: boolean } }>,
  response: string,
  hasExternalInput: boolean,
): TurnClassification {
  if (hasExternalInput) return 'conversation';
  if (toolCalls.length === 0 && response.length < 50) return 'idle';

  if (toolCalls.some(tc => !tc.result.success)) return 'error';

  const mutatingTools = new Set([
    'write_file', 'exec', 'edit_own_file', 'install_npm_package',
    'transfer_credits', 'spawn_child', 'update_soul',
  ]);

  if (toolCalls.some(tc => mutatingTools.has(tc.name))) return 'action';
  if (response.includes('I will') || response.includes('I should') || response.includes('my decision')) return 'decision';

  return 'observation';
}

export function calculateImportance(classification: TurnClassification): number {
  switch (classification) {
    case 'action': return 0.8;
    case 'decision': return 0.7;
    case 'conversation': return 0.6;
    case 'observation': return 0.4;
    case 'error': return 0.5;
    case 'idle': return 0.1;
  }
}
