/**
 * Conway Automaton — State Versioning
 * Initializes ~/.automaton as a git repo for version control of all state.
 */

import { execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '../observability/logger.js';

const logger = createLogger('git:state-versioning');

export function initGitRepo(homeDir: string): void {
  const gitDir = join(homeDir, '.git');
  if (existsSync(gitDir)) {
    logger.debug('Git repo already initialized');
    return;
  }

  try {
    execSync('git init', { cwd: homeDir, stdio: 'ignore' });
    execSync('git config user.email "automaton@conway.tech"', { cwd: homeDir, stdio: 'ignore' });
    execSync('git config user.name "Automaton"', { cwd: homeDir, stdio: 'ignore' });

    // Create .gitignore for sensitive files
    const gitignore = `
wallet.json
api-key
state.db
*.log
node_modules/
dist/
`.trim();
    writeFileSync(join(homeDir, '.gitignore'), gitignore);

    logger.info('Git repo initialized', { path: homeDir });
  } catch (err) {
    logger.error('Failed to init git repo', { error: String(err) });
  }
}

export function autoCommit(homeDir: string, message: string): void {
  try {
    execSync('git add -A', { cwd: homeDir, stdio: 'ignore' });
    execSync(`git commit -m "${message}" --allow-empty`, { cwd: homeDir, stdio: 'ignore' });
  } catch {
    // No changes to commit
  }
}
