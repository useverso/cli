import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolve the templates/ directory relative to the package root.
 * Works both from source (tsx src/...) and from dist (node dist/...).
 */
function getTemplatesDir(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  return join(__dirname, '..', 'templates');
}

/** Get template content by relative path (e.g. "yaml/config.yaml"). */
export function getTemplate(path: string): string | undefined {
  try {
    const fullPath = join(getTemplatesDir(), path);
    return readFileSync(fullPath, 'utf-8');
  } catch {
    return undefined;
  }
}

/** List all template files (relative paths). */
export function listTemplates(): string[] {
  const root = getTemplatesDir();
  const results: string[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else {
        results.push(relative(root, full));
      }
    }
  }

  try {
    walk(root);
  } catch {
    // templates dir missing — return empty
  }
  return results.sort();
}

/**
 * Compose pilot.md from core.md + scale-specific role file.
 * If the role file exists, concatenate with a separator.
 */
export function composePilot(scale: string): string {
  const core = getTemplate('agents/pilot/core.md') ?? '';

  const roleFile: Record<string, string> = {
    solo: 'agents/pilot/solo-dev.md',
    'small-team': 'agents/pilot/team-dev.md',
    startup: 'agents/pilot/tech-lead.md',
    enterprise: 'agents/pilot/pm.md',
  };

  const role = roleFile[scale] ? getTemplate(roleFile[scale]) : undefined;

  if (role) {
    return `${core}\n\n---\n\n${role}`;
  }
  return core;
}
