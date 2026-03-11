import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';

import { scaffoldVerso } from '../../src/commands/init';
import {
  runUpgrade,
  computeChecksums,
  saveChecksums,
  loadChecksums,
} from '../../src/commands/upgrade';
import { loadConfig } from '../../src/core/config';
import { composePilot } from '../../src/templates';

// ---------------------------------------------------------------------------
// Checksum helpers
// ---------------------------------------------------------------------------
describe('checksum utilities', () => {
  let tmpDir: string;
  let versoDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'verso-upgrade-test-'));
    versoDir = join(tmpDir, '.verso');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects unmodified templates via checksum comparison', () => {
    scaffoldVerso(versoDir, 'solo');
    const checksums1 = computeChecksums(versoDir);
    const checksums2 = computeChecksums(versoDir);

    // All checksums should match — nothing changed
    for (const [file, hash] of Object.entries(checksums1)) {
      expect(checksums2[file], `checksum mismatch for ${file}`).toBe(hash);
    }
  });

  it('saveChecksums and loadChecksums round-trip correctly', () => {
    mkdirSync(versoDir, { recursive: true });
    const checksums = { 'config.yaml': 'abc123', 'board.yaml': 'def456' };
    saveChecksums(versoDir, checksums);
    const loaded = loadChecksums(versoDir);
    expect(loaded).toEqual(checksums);
  });

  it('loadChecksums returns null when file does not exist', () => {
    mkdirSync(versoDir, { recursive: true });
    expect(loadChecksums(versoDir)).toBeNull();
  });

  it('computeChecksums skips .checksums.json', () => {
    scaffoldVerso(versoDir, 'solo');
    const checksums = computeChecksums(versoDir);
    saveChecksums(versoDir, checksums);
    const checksums2 = computeChecksums(versoDir);
    expect(checksums2).not.toHaveProperty('.checksums.json');
  });
});

// ---------------------------------------------------------------------------
// Upgrade: unmodified files get updated
// ---------------------------------------------------------------------------
describe('verso upgrade — unmodified files', () => {
  let tmpDir: string;
  let versoDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'verso-upgrade-test-'));
    versoDir = join(tmpDir, '.verso');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('updates unmodified template files', () => {
    scaffoldVerso(versoDir, 'solo');
    // scaffoldVerso now saves checksums automatically

    const result = runUpgrade(versoDir);

    // All template files should appear in updated (none modified)
    expect(result.updated.length).toBeGreaterThan(0);
    expect(result.preserved).toEqual([]);

    // Verify known files are in updated
    expect(result.updated).toContain('board.yaml');
    expect(result.updated).toContain('agents/builder.md');
    expect(result.updated).toContain('templates/pr.md');
  });
});

// ---------------------------------------------------------------------------
// Upgrade: user-modified files are preserved
// ---------------------------------------------------------------------------
describe('verso upgrade — user-modified files', () => {
  let tmpDir: string;
  let versoDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'verso-upgrade-test-'));
    versoDir = join(tmpDir, '.verso');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('preserves files the user has customized', () => {
    scaffoldVerso(versoDir, 'solo');

    // Modify builder.md after init
    const builderPath = join(versoDir, 'agents', 'builder.md');
    writeFileSync(builderPath, '# My custom builder agent\n\nCustom instructions here.\n', 'utf-8');

    const result = runUpgrade(versoDir);

    // builder.md should be preserved, not updated
    expect(result.preserved).toContain('agents/builder.md');
    expect(result.updated).not.toContain('agents/builder.md');

    // Verify file content was NOT overwritten
    const content = readFileSync(builderPath, 'utf-8');
    expect(content).toContain('My custom builder agent');
  });

  it('updates unmodified files while preserving modified ones', () => {
    scaffoldVerso(versoDir, 'solo');

    // Modify only builder.md
    writeFileSync(
      join(versoDir, 'agents', 'builder.md'),
      '# Custom builder\n',
      'utf-8',
    );

    const result = runUpgrade(versoDir);

    // builder.md preserved
    expect(result.preserved).toContain('agents/builder.md');

    // reviewer.md and other unmodified files updated
    expect(result.updated).toContain('agents/reviewer.md');
    expect(result.updated).toContain('board.yaml');
  });
});

// ---------------------------------------------------------------------------
// Upgrade: config deep merge
// ---------------------------------------------------------------------------
describe('verso upgrade — config merge', () => {
  let tmpDir: string;
  let versoDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'verso-upgrade-test-'));
    versoDir = join(tmpDir, '.verso');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('merges new config keys while preserving user values', () => {
    scaffoldVerso(versoDir, 'solo');

    // Simulate user customizing config — change scale and remove a key
    const configPath = join(versoDir, 'config.yaml');
    const config = yaml.load(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    config.scale = 'startup';
    // Remove the 'debt' section to simulate an older config missing new keys
    delete config.debt;
    writeFileSync(configPath, yaml.dump(config, { lineWidth: -1, noRefs: true }), 'utf-8');

    // Do NOT update checksums — config.yaml is now "user-modified" (checksum mismatch)
    // This means upgrade will preserve it, then the deep merge adds missing keys

    const result = runUpgrade(versoDir);

    // After upgrade, config should have user's scale preserved
    const upgraded = yaml.load(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    expect(upgraded.scale).toBe('startup');

    // And the missing 'debt' key should be added back from defaults
    expect(upgraded.debt).toBeDefined();
    expect((upgraded.debt as Record<string, unknown>).target_ratio).toBe(0.2);
  });
});

// ---------------------------------------------------------------------------
// Upgrade: schema migrations
// ---------------------------------------------------------------------------
describe('verso upgrade — schema migrations', () => {
  let tmpDir: string;
  let versoDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'verso-upgrade-test-'));
    versoDir = join(tmpDir, '.verso');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs schema migrations on board.yaml', () => {
    // Scaffold normally first
    scaffoldVerso(versoDir, 'solo');

    // Replace board.yaml with a v1 schema to trigger migration
    const boardPath = join(versoDir, 'board.yaml');
    const v1Board = yaml.dump({
      schema_version: 1,
      items: [
        {
          id: 1,
          title: 'Test item',
          type: 'feature',
          state: 'captured',
          assignee: '',
          autonomy: 2,
          branch: '',
          pr: '',
          retries: 0,
          complexity: '',
          agent_sessions: 0,
          created_at: '2025-01-01',
          updated_at: '2025-01-01',
          labels: [],
          transitions: [],
          reviews: [],
          external: {},
        },
      ],
    });
    writeFileSync(boardPath, v1Board, 'utf-8');

    // Update checksums to match the modified board
    const checksums = computeChecksums(versoDir);
    saveChecksums(versoDir, checksums);

    const result = runUpgrade(versoDir);

    // Should report migration
    expect(result.migrated.length).toBeGreaterThan(0);
    expect(result.migrated[0]).toContain('board.yaml');
    expect(result.migrated[0]).toContain('1');
    expect(result.migrated[0]).toContain('2');

    // Verify board.yaml is now v2
    const upgraded = yaml.load(readFileSync(boardPath, 'utf-8')) as Record<string, unknown>;
    expect(upgraded.schema_version).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Upgrade: pilot.md recomposition
// ---------------------------------------------------------------------------
describe('verso upgrade — pilot recomposition', () => {
  let tmpDir: string;
  let versoDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'verso-upgrade-test-'));
    versoDir = join(tmpDir, '.verso');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('recomposes pilot.md from modular sources', () => {
    scaffoldVerso(versoDir, 'solo');

    const result = runUpgrade(versoDir);

    expect(result.recomposed).toBe(true);

    // Verify pilot.md content matches the expected composition
    const pilotPath = join(versoDir, 'agents', 'pilot.md');
    const content = readFileSync(pilotPath, 'utf-8');
    const expected = composePilot('solo');
    expect(content).toBe(expected);
  });

  it('recomposes pilot.md using scale from config', () => {
    scaffoldVerso(versoDir, 'startup');

    // Mark config.yaml as user-modified so upgrade preserves the startup scale
    // (otherwise upgrade replaces it with template default which has scale: solo)
    const configPath = join(versoDir, 'config.yaml');
    const configContent = readFileSync(configPath, 'utf-8');
    writeFileSync(configPath, configContent + '\n# user comment\n', 'utf-8');

    const result = runUpgrade(versoDir);

    expect(result.recomposed).toBe(true);

    const pilotPath = join(versoDir, 'agents', 'pilot.md');
    const content = readFileSync(pilotPath, 'utf-8');
    expect(content).toContain('Tech Lead');
  });
});

// ---------------------------------------------------------------------------
// Upgrade: reports what changed
// ---------------------------------------------------------------------------
describe('verso upgrade — change reporting', () => {
  let tmpDir: string;
  let versoDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'verso-upgrade-test-'));
    versoDir = join(tmpDir, '.verso');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reports updated, preserved, and added files correctly', () => {
    scaffoldVerso(versoDir, 'solo');

    // Modify one file
    writeFileSync(
      join(versoDir, 'agents', 'reviewer.md'),
      '# Custom reviewer\n',
      'utf-8',
    );

    // Delete a template file to simulate a new template being added
    const specPath = join(versoDir, 'templates', 'spec.md');
    rmSync(specPath);

    const result = runUpgrade(versoDir);

    // reviewer.md was modified → preserved
    expect(result.preserved).toContain('agents/reviewer.md');

    // spec.md was deleted → added back
    expect(result.added).toContain('templates/spec.md');
    expect(existsSync(specPath)).toBe(true);

    // Other unmodified files → updated
    expect(result.updated).toContain('agents/builder.md');
    expect(result.updated).toContain('board.yaml');
  });
});

// ---------------------------------------------------------------------------
// Upgrade: legacy project without checksums
// ---------------------------------------------------------------------------
describe('verso upgrade — legacy project without checksums', () => {
  let tmpDir: string;
  let versoDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'verso-upgrade-test-'));
    versoDir = join(tmpDir, '.verso');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('treats all existing files as preserved when no checksums exist', () => {
    scaffoldVerso(versoDir, 'solo');

    // Remove the checksums file to simulate a legacy project
    const checksumsPath = join(versoDir, '.checksums.json');
    if (existsSync(checksumsPath)) {
      rmSync(checksumsPath);
    }

    const result = runUpgrade(versoDir);

    // All existing files should be preserved (safe default)
    expect(result.preserved.length).toBeGreaterThan(0);
    expect(result.updated).toEqual([]);

    // Verify known files are in preserved
    expect(result.preserved).toContain('config.yaml');
    expect(result.preserved).toContain('board.yaml');
    expect(result.preserved).toContain('agents/builder.md');
  });

  it('creates .checksums.json after upgrade for future use', () => {
    scaffoldVerso(versoDir, 'solo');

    // Remove checksums
    const checksumsPath = join(versoDir, '.checksums.json');
    if (existsSync(checksumsPath)) {
      rmSync(checksumsPath);
    }

    runUpgrade(versoDir);

    // Checksums file should now exist for future upgrades
    expect(existsSync(checksumsPath)).toBe(true);
    const checksums = loadChecksums(versoDir);
    expect(checksums).not.toBeNull();
    expect(Object.keys(checksums!).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Upgrade: error when .verso/ doesn't exist
// ---------------------------------------------------------------------------
describe('verso upgrade — error handling', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'verso-upgrade-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('throws when .verso/ directory does not exist', () => {
    const versoDir = join(tmpDir, '.verso');
    expect(() => runUpgrade(versoDir)).toThrow('.verso directory not found');
  });
});
