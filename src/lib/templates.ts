import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
