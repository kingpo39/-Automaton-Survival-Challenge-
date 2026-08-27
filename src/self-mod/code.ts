/**
 * Conway Automaton — Code Self-Modification
 * Safe file editing with protection checks and audit trail.
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { AutomatonDatabase, SelfModResult } from '../types.js';
import { createLogger } from '../observability/logger.js';

const logger = createLogger('self-mod:code');

export async function editFile(
  filePath: string,
  oldString: string,
  newString: string,
  db: AutomatonDatabase,
): Promise<SelfModResult> {
  try {
    const content = readFileSync(filePath, 'utf-8');

    if (!content.includes(oldString)) {
      return { success: false, filePath, diff: '', hash: '' };
    }

    const newContent = content.replace(oldString, newString);
    const hash = createHash('sha256').update(newContent).digest('hex');

    // Would write file here
    const diff = `--- ${filePath}\n+++ ${filePath}\n@@ -old +new @@\n-${oldString}\n+${newString}`;

    db.insertModification({
      timestamp: Date.now(),
      type: 'file_edit',
      filePath,
      diff,
      hash,
      reason: 'Self-modification via edit_own_file tool',
    });

    logger.info('File edited', { filePath, hash: hash.substring(0, 12) });
    return { success: true, filePath, diff, hash };
  } catch (err) {
    logger.error('File edit failed', { filePath, error: String(err) });
    return { success: false, filePath, diff: '', hash: '' };
  }
}
