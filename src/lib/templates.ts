import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Role } from '../types/index.js';
import { PILOT_MODULE_FOR_ROLE } from '../constants.js';

/**
 * Resolve the path to the bundled templates/ directory.
 * Works in both dev (tsx src/index.ts) and dist (node dist/index.js) modes.
 */
export function getTemplatesDir(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = dirname(thisFile);

  // In dist mode: dist/lib/templates.js -> ../../templates
  // In dev mode: src/lib/templates.ts -> ../../templates
  const candidates = [
    join(thisDir, '..', '..', 'templates'),   // from src/lib/ or dist/lib/
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    'Could not find templates directory. This is a bug in @useverso/cli.'
  );
}

/**
 * Compose a pilot prompt by concatenating the shared core with the
 * role-specific module. Returns the full content that should be written
 * as `.verso/agents/pilot.md` in the user's project.
 */
export async function composePilot(role: Role): Promise<string> {
  const templatesDir = getTemplatesDir();
  const pilotDir = join(templatesDir, '.verso', 'agents', 'pilot');

  const coreContent = await readFile(join(pilotDir, 'core.md'), 'utf-8');
  const roleFile = PILOT_MODULE_FOR_ROLE[role];
  const roleContent = await readFile(join(pilotDir, roleFile), 'utf-8');

  return coreContent.trimEnd() + '\n---\n\n' + roleContent.trimStart();
}
