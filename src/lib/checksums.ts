import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChecksumManifest } from '../types/index.js';
import { CHECKSUMS_FILE, TEMPLATE_FILES } from '../constants.js';

/**
 * Generate SHA-256 hash of a file's contents.
 */
export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Generate checksums for all template files in a directory.
 */
export async function generateChecksums(projectRoot: string): Promise<ChecksumManifest> {
  const files: Record<string, string> = {};

  for (const relPath of TEMPLATE_FILES) {
    try {
      const content = await readFile(join(projectRoot, relPath), 'utf-8');
      files[relPath] = hashContent(content);
    } catch {
      // File doesn't exist — skip (e.g., pilot variant not copied)
    }
  }

  // Read version from the CLI's own package.json
  let version = '0.0.0';
  try {
    const pkgPath = fileURLToPath(new URL('../../package.json', import.meta.url));
    const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
    version = pkg.version || '0.0.0';
  } catch {
    // fallback to 0.0.0
  }

  return { version, files };
}

/**
 * Read the checksums manifest from a project.
 */
export async function readChecksums(projectRoot: string): Promise<ChecksumManifest | null> {
  try {
    const raw = await readFile(join(projectRoot, CHECKSUMS_FILE), 'utf-8');
    return JSON.parse(raw) as ChecksumManifest;
  } catch {
    return null;
  }
}

/**
 * Write the checksums manifest to a project.
 */
export async function writeChecksums(projectRoot: string, manifest: ChecksumManifest): Promise<void> {
  await writeFile(
    join(projectRoot, CHECKSUMS_FILE),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf-8',
  );
}
