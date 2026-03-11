import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { Command } from 'commander';
import yaml from 'js-yaml';

import { loadConfig, saveConfig, defaultConfig } from '../core/config.js';
import * as schema from '../core/schema.js';
import { getTemplate, composePilot } from '../templates.js';
import type { OutputFormat } from '../output.js';
import * as ui from '../ui.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UpgradeResult {
  updated: string[];
  preserved: string[];
  added: string[];
  migrated: string[];
  recomposed: boolean;
}

// ---------------------------------------------------------------------------
// Template mapping — local path in .verso/ → template path in templates/
// ---------------------------------------------------------------------------

const TEMPLATE_FILES: Record<string, string> = {
  'config.yaml': 'yaml/config.yaml',
  'board.yaml': 'yaml/board.yaml',
  'roadmap.yaml': 'yaml/roadmap.yaml',
  'state-machine.yaml': 'yaml/state-machine.yaml',
  'releases.yaml': 'yaml/releases.yaml',
  'agents/builder.md': 'agents/builder.md',
  'agents/reviewer.md': 'agents/reviewer.md',
  'templates/issue-feature.md': 'templates/issue-feature.md',
  'templates/issue-bug.md': 'templates/issue-bug.md',
  'templates/issue-hotfix.md': 'templates/issue-hotfix.md',
  'templates/issue-chore.md': 'templates/issue-chore.md',
  'templates/spec.md': 'templates/spec.md',
  'templates/pr.md': 'templates/pr.md',
};

// ---------------------------------------------------------------------------
// Checksum helpers
// ---------------------------------------------------------------------------

function fileChecksum(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

function contentChecksum(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

const CHECKSUMS_FILE = '.checksums.json';

/**
 * Compute SHA-256 checksums for all files in versoDir (recursively).
 * Returns a map of relative path -> hex digest.
 * Skips .checksums.json itself.
 */
export function computeChecksums(versoDir: string): Record<string, string> {
  const result: Record<string, string> = {};

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      const rel = path.relative(versoDir, full);
      if (rel === CHECKSUMS_FILE) continue;
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else {
        result[rel] = fileChecksum(full);
      }
    }
  }

  walk(versoDir);
  return result;
}

/** Save checksums to .verso/.checksums.json */
export function saveChecksums(versoDir: string, checksums: Record<string, string>): void {
  const filePath = path.join(versoDir, CHECKSUMS_FILE);
  fs.writeFileSync(filePath, JSON.stringify(checksums, null, 2) + '\n', 'utf-8');
}

/** Load checksums from .verso/.checksums.json. Returns null if file doesn't exist. */
export function loadChecksums(versoDir: string): Record<string, string> | null {
  const filePath = path.join(versoDir, CHECKSUMS_FILE);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Deep merge — adds missing keys from source into target without overwriting
// ---------------------------------------------------------------------------

function deepMergeNewKeys(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (!(key in result)) {
      result[key] = source[key];
    } else if (
      typeof result[key] === 'object' &&
      result[key] !== null &&
      !Array.isArray(result[key]) &&
      typeof source[key] === 'object' &&
      source[key] !== null &&
      !Array.isArray(source[key])
    ) {
      result[key] = deepMergeNewKeys(
        result[key] as Record<string, unknown>,
        source[key] as Record<string, unknown>,
      );
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Core upgrade logic
// ---------------------------------------------------------------------------

export function runUpgrade(versoDir: string): UpgradeResult {
  if (!fs.existsSync(versoDir)) {
    throw new Error('.verso directory not found');
  }

  const result: UpgradeResult = {
    updated: [],
    preserved: [],
    added: [],
    migrated: [],
    recomposed: false,
  };

  // 1. Load stored checksums (null = legacy project without checksums)
  const storedChecksums = loadChecksums(versoDir);

  // 2. Schema migrations (before template updates)
  for (const yamlFile of ['config.yaml', 'board.yaml']) {
    const filePath = path.join(versoDir, yamlFile);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf-8');
    const version = schema.detectSchemaVersion(content);
    if (schema.needsMigration(version, schema.CURRENT_SCHEMA_VERSION)) {
      try {
        const migrated = schema.migrate(content, version, schema.CURRENT_SCHEMA_VERSION);
        fs.writeFileSync(filePath, migrated, 'utf-8');
        result.migrated.push(`${yamlFile}: ${version} -> ${schema.CURRENT_SCHEMA_VERSION}`);
      } catch {
        // Migration failed — file is preserved as-is
      }
    }
  }

  // 3. Process each template file
  for (const [localPath, templatePath] of Object.entries(TEMPLATE_FILES)) {
    const fullPath = path.join(versoDir, localPath);
    const templateContent = getTemplate(templatePath);
    if (!templateContent) continue;

    // File doesn't exist → add it
    if (!fs.existsSync(fullPath)) {
      // Ensure parent directory exists
      const dir = path.dirname(fullPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, templateContent, 'utf-8');
      result.added.push(localPath);
      continue;
    }

    // No stored checksums (legacy) → treat all files as potentially modified
    if (storedChecksums === null) {
      result.preserved.push(localPath);
      continue;
    }

    // Compare current file checksum against stored checksum
    const currentChecksum = fileChecksum(fullPath);
    const storedChecksum = storedChecksums[localPath];

    if (storedChecksum && currentChecksum === storedChecksum) {
      // Unmodified — safe to replace with latest template
      fs.writeFileSync(fullPath, templateContent, 'utf-8');
      result.updated.push(localPath);
    } else {
      // User modified or checksum missing — preserve
      result.preserved.push(localPath);
    }
  }

  // 4. Deep merge config.yaml — add new keys, preserve existing values
  const configPath = path.join(versoDir, 'config.yaml');
  if (fs.existsSync(configPath)) {
    try {
      const userConfig = yaml.load(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
      const defaults = defaultConfig() as unknown as Record<string, unknown>;
      const merged = deepMergeNewKeys(userConfig, defaults);
      const mergedYaml = yaml.dump(merged, { lineWidth: -1, noRefs: true });
      fs.writeFileSync(configPath, mergedYaml, 'utf-8');
    } catch {
      // Config merge failed — leave as-is
    }
  }

  // 5. Recompose pilot.md
  try {
    const config = loadConfig(versoDir);
    const pilotContent = composePilot(config.scale);
    const pilotPath = path.join(versoDir, 'agents', 'pilot.md');
    fs.mkdirSync(path.dirname(pilotPath), { recursive: true });
    fs.writeFileSync(pilotPath, pilotContent, 'utf-8');
    result.recomposed = true;
  } catch {
    // Pilot recomposition failed
  }

  // 6. Save updated checksums
  const newChecksums = computeChecksums(versoDir);
  saveChecksums(versoDir, newChecksums);

  return result;
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

function getFormat(cmd: Command): OutputFormat {
  return cmd.optsWithGlobals().format ?? 'human';
}

export function registerUpgradeCommand(program: Command): void {
  program
    .command('upgrade')
    .description('Upgrade .verso configuration to latest templates and schema')
    .action(() => {
      const format = getFormat(program);
      const dir = `${process.cwd()}/.verso`;

      try {
        const result = runUpgrade(dir);
        const nothingToDo =
          result.updated.length === 0 &&
          result.preserved.length === 0 &&
          result.added.length === 0 &&
          result.migrated.length === 0;

        switch (format) {
          case 'human':
            console.log(ui.heading('VERSO Upgrade'));
            console.log();
            if (nothingToDo && !result.recomposed) {
              console.log(`  ${ui.success('Everything is up to date.')}`);
            } else {
              for (const msg of result.migrated) {
                console.log(`  ${ui.success('migrated:')} ${msg}`);
              }
              for (const f of result.updated) {
                console.log(`  ${ui.success('updated:')} ${f}`);
              }
              for (const f of result.added) {
                console.log(`  ${ui.success('added:')} ${f}`);
              }
              for (const f of result.preserved) {
                console.log(`  ${ui.warn('preserved:')} ${f}`);
              }
              if (result.recomposed) {
                console.log(`  ${ui.success('recomposed:')} agents/pilot.md`);
              }
            }
            break;

          case 'plain':
            if (nothingToDo && !result.recomposed) {
              console.log('status: up_to_date');
            } else {
              for (const msg of result.migrated) console.log(`migrated: ${msg}`);
              for (const f of result.updated) console.log(`updated: ${f}`);
              for (const f of result.added) console.log(`added: ${f}`);
              for (const f of result.preserved) console.log(`preserved: ${f}`);
              if (result.recomposed) console.log('recomposed: agents/pilot.md');
            }
            break;

          case 'json':
            console.log(JSON.stringify(result, null, 2));
            break;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        switch (format) {
          case 'human':
            console.error(`${ui.error('error:')} ${msg}`);
            break;
          case 'plain':
            console.error(`error: ${msg}`);
            break;
          case 'json':
            console.error(JSON.stringify({ error: msg }));
            break;
        }
        process.exitCode = 1;
      }
    });
}
