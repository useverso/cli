import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';

import { loadUserConfig, saveUserConfig, createDefaultUserConfig } from '../../src/core/user.js';
import type { UserConfig } from '../../src/core/types.js';

describe('loadUserConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'verso-user-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns config when .verso.yaml exists with valid content', () => {
    const config: UserConfig = {
      user: { name: 'Jane Doe', github: 'janedoe', role: 'captain' },
      preferences: { format: 'human', autonomy_override: null },
    };
    writeFileSync(join(tmpDir, '.verso.yaml'), yaml.dump(config), 'utf-8');

    const result = loadUserConfig(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.user.name).toBe('Jane Doe');
    expect(result!.user.github).toBe('janedoe');
    expect(result!.user.role).toBe('captain');
    expect(result!.preferences?.format).toBe('human');
  });

  it('returns null when .verso.yaml does not exist', () => {
    const result = loadUserConfig(tmpDir);
    expect(result).toBeNull();
  });

  it('returns null when .verso.yaml has invalid content (missing required fields)', () => {
    writeFileSync(join(tmpDir, '.verso.yaml'), yaml.dump({ user: { name: '' } }), 'utf-8');
    const result = loadUserConfig(tmpDir);
    expect(result).toBeNull();
  });

  it('returns config without optional github field', () => {
    const config: UserConfig = {
      user: { name: 'Solo Dev', role: 'captain' },
    };
    writeFileSync(join(tmpDir, '.verso.yaml'), yaml.dump(config), 'utf-8');

    const result = loadUserConfig(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.user.name).toBe('Solo Dev');
    expect(result!.user.github).toBeUndefined();
  });
});

describe('saveUserConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'verso-user-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes .verso.yaml with correct YAML content', () => {
    const config: UserConfig = {
      user: { name: 'John Doe', github: 'johndoe', role: 'captain' },
      preferences: { format: 'json', autonomy_override: 3 },
    };

    saveUserConfig(tmpDir, config);

    const filePath = join(tmpDir, '.verso.yaml');
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, 'utf-8');
    const parsed = yaml.load(content) as UserConfig;
    expect(parsed.user.name).toBe('John Doe');
    expect(parsed.user.github).toBe('johndoe');
    expect(parsed.user.role).toBe('captain');
    expect(parsed.preferences?.format).toBe('json');
    expect(parsed.preferences?.autonomy_override).toBe(3);
  });

  it('round-trips correctly (save then load)', () => {
    const config: UserConfig = {
      user: { name: 'Round Trip', github: 'roundtrip', role: 'reviewer' },
      preferences: { format: 'plain', autonomy_override: null },
    };

    saveUserConfig(tmpDir, config);
    const loaded = loadUserConfig(tmpDir);

    expect(loaded).not.toBeNull();
    expect(loaded!.user.name).toBe('Round Trip');
    expect(loaded!.user.github).toBe('roundtrip');
    expect(loaded!.user.role).toBe('reviewer');
    expect(loaded!.preferences?.format).toBe('plain');
    expect(loaded!.preferences?.autonomy_override).toBeNull();
  });
});

describe('createDefaultUserConfig', () => {
  it('returns a valid UserConfig with sensible defaults', () => {
    const config = createDefaultUserConfig();
    expect(config.user).toBeDefined();
    expect(config.user.name).toBeTruthy();
    expect(config.user.role).toBe('captain');
    expect(config.preferences).toBeDefined();
    expect(config.preferences?.format).toBe('human');
    expect(config.preferences?.autonomy_override).toBeNull();
  });
});

describe('init --defaults creates .verso.yaml', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'verso-user-init-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('init --defaults creates .verso.yaml in project root', () => {
    const { execSync } = require('node:child_process');
    execSync(
      `cd "${tmpDir}" && npx tsx "${join(__dirname, '..', '..', 'src', 'index.ts')}" init --defaults`,
      { encoding: 'utf-8' },
    );

    const versoYamlPath = join(tmpDir, '.verso.yaml');
    expect(existsSync(versoYamlPath)).toBe(true);

    const loaded = loadUserConfig(tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.user.role).toBe('captain');
    expect(loaded!.user.name).toBeTruthy();
  });

  it('.verso.yaml is in .gitignore after init --defaults', () => {
    const { execSync } = require('node:child_process');
    execSync(
      `cd "${tmpDir}" && npx tsx "${join(__dirname, '..', '..', 'src', 'index.ts')}" init --defaults`,
      { encoding: 'utf-8' },
    );

    const gitignoreContent = readFileSync(join(tmpDir, '.gitignore'), 'utf-8');
    expect(gitignoreContent).toContain('.verso.yaml');
  });
});

describe('UserConfig type validation', () => {
  it('required fields: user.name and user.role must be present', () => {
    const valid: UserConfig = {
      user: { name: 'Test', role: 'captain' },
    };
    expect(valid.user.name).toBe('Test');
    expect(valid.user.role).toBe('captain');
  });

  it('optional fields: github and preferences can be omitted', () => {
    const minimal: UserConfig = {
      user: { name: 'Minimal', role: 'captain' },
    };
    expect(minimal.user.github).toBeUndefined();
    expect(minimal.preferences).toBeUndefined();
  });

  it('preferences can include format and autonomy_override', () => {
    const full: UserConfig = {
      user: { name: 'Full', github: 'full', role: 'pilot' },
      preferences: { format: 'json', autonomy_override: 4 },
    };
    expect(full.preferences?.format).toBe('json');
    expect(full.preferences?.autonomy_override).toBe(4);
  });
});
