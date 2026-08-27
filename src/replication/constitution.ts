/**
 * Conway Automaton — Constitution
 * Propagate constitution to children and verify integrity via hash.
 */

import { createHash } from 'node:crypto';

export function computeConstitutionHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function verifyConstitution(childHash: string, parentHash: string): boolean {
  return childHash === parentHash;
}

export function propagateConstitution(
  parentConstitution: string,
  childConstitutionHash: string,
): { propagated: boolean; hash: string } {
  const hash = computeConstitutionHash(parentConstitution);
  return {
    propagated: hash === childConstitutionHash,
    hash,
  };
}
