import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

/**
 * Detect the project name from common config files.
 * Falls back to the directory name.
 */
export async function detectProjectName(projectRoot: string): Promise<string> {
  // Try package.json
  try {
    const raw = await readFile(join(projectRoot, 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw);
    if (pkg.name && typeof pkg.name === 'string') {
      // Strip scope if present (@org/name -> name)
      return pkg.name.replace(/^@[^/]+\//, '');
    }
  } catch { /* not found or invalid */ }

  // Try Cargo.toml
  try {
    const raw = await readFile(join(projectRoot, 'Cargo.toml'), 'utf-8');
    const match = raw.match(/^\s*name\s*=\s*"([^"]+)"/m);
    if (match) return match[1];
  } catch { /* not found */ }

  // Try go.mod
  try {
    const raw = await readFile(join(projectRoot, 'go.mod'), 'utf-8');
    const match = raw.match(/^module\s+(\S+)/m);
    if (match) {
      // Use last segment of module path
      const parts = match[1].split('/');
      return parts[parts.length - 1];
    }
  } catch { /* not found */ }

  // Try pyproject.toml
  try {
    const raw = await readFile(join(projectRoot, 'pyproject.toml'), 'utf-8');
    const match = raw.match(/^\s*name\s*=\s*"([^"]+)"/m);
    if (match) return match[1];
  } catch { /* not found */ }

  // Fallback: directory name
  return basename(projectRoot);
}

/**
 * Check if the current directory is a git repository.
 */
export async function isGitRepo(projectRoot: string): Promise<boolean> {
  try {
    await readFile(join(projectRoot, '.git/HEAD'), 'utf-8');
    return true;
  } catch {
    return false;
  }
}
