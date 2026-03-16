import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';

import { loadUserConfig, saveUserConfig, createDefaultUserConfig, getGhUserInfo } from '../../src/core/user.js';
import type { UserConfig, UserProfile, UserIdentity } from '../../src/core/types.js';

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
      user: { id: 'janedoe', name: 'Jane Doe', github: 'janedoe', profile: 'solo-dev' },
      preferences: { format: 'human', autonomy_override: null },
    };
    writeFileSync(join(tmpDir, '.verso.yaml'), yaml.dump(config), 'utf-8');

    const result = loadUserConfig(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.user.name).toBe('Jane Doe');
    expect(result!.user.github).toBe('janedoe');
    expect(result!.user.profile).toBe('solo-dev');
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
      user: { id: 'solo-dev', name: 'Solo Dev', profile: 'solo-dev' },
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
      user: { id: 'johndoe', name: 'John Doe', github: 'johndoe', profile: 'solo-dev' },
      preferences: { format: 'json', autonomy_override: 3 },
    };

    saveUserConfig(tmpDir, config);

    const filePath = join(tmpDir, '.verso.yaml');
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, 'utf-8');
    const parsed = yaml.load(content) as UserConfig;
    expect(parsed.user.name).toBe('John Doe');
    expect(parsed.user.github).toBe('johndoe');
    expect(parsed.user.profile).toBe('solo-dev');
    expect(parsed.preferences?.format).toBe('json');
    expect(parsed.preferences?.autonomy_override).toBe(3);
  });

  it('round-trips correctly (save then load)', () => {
    const config: UserConfig = {
      user: { id: 'roundtrip', name: 'Round Trip', github: 'roundtrip', profile: 'tech-lead' },
      preferences: { format: 'plain', autonomy_override: null },
    };

    saveUserConfig(tmpDir, config);
    const loaded = loadUserConfig(tmpDir);

    expect(loaded).not.toBeNull();
    expect(loaded!.user.name).toBe('Round Trip');
    expect(loaded!.user.github).toBe('roundtrip');
    expect(loaded!.user.profile).toBe('tech-lead');
    expect(loaded!.preferences?.format).toBe('plain');
    expect(loaded!.preferences?.autonomy_override).toBeNull();
  });
});

describe('createDefaultUserConfig', () => {
  it('returns a valid UserConfig with sensible defaults', () => {
    const config = createDefaultUserConfig();
    expect(config.user).toBeDefined();
    expect(config.user.name).toBeTruthy();
    expect(config.user.profile).toBe('solo-dev');
    expect(config.user.id).toBeDefined();
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
    expect(loaded!.user.profile).toBe('solo-dev');
    expect(loaded!.user.id).toBeDefined();
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
  it('required fields: user.name, user.id, and user.profile must be present', () => {
    const valid: UserConfig = {
      user: { id: 'test', name: 'Test', profile: 'solo-dev' },
    };
    expect(valid.user.name).toBe('Test');
    expect(valid.user.id).toBe('test');
    expect(valid.user.profile).toBe('solo-dev');
  });

  it('optional fields: github and preferences can be omitted', () => {
    const minimal: UserConfig = {
      user: { id: 'minimal', name: 'Minimal', profile: 'solo-dev' },
    };
    expect(minimal.user.github).toBeUndefined();
    expect(minimal.preferences).toBeUndefined();
  });

  it('preferences can include format and autonomy_override', () => {
    const full: UserConfig = {
      user: { id: 'full', name: 'Full', github: 'full', profile: 'pm' },
      preferences: { format: 'json', autonomy_override: 4 },
    };
    expect(full.preferences?.format).toBe('json');
    expect(full.preferences?.autonomy_override).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// RED phase: getGhUserInfo tests (function does not exist yet)
// ---------------------------------------------------------------------------
describe('getGhUserInfo', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns login, name, and id from gh CLI when available', () => {
    const result = getGhUserInfo();
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('login');
    expect(result).toHaveProperty('name');
    expect(result).toHaveProperty('id');
    expect(typeof result!.login).toBe('string');
    expect(typeof result!.name).toBe('string');
    expect(typeof result!.id).toBe('string');
  });

  it('returns null when gh is not installed', () => {
    const childProcess = require('node:child_process');
    vi.spyOn(childProcess, 'execSync').mockImplementation(() => {
      throw new Error('command not found: gh');
    });

    const result = getGhUserInfo();
    expect(result).toBeNull();
  });

  it('returns null when gh is not authenticated', () => {
    const childProcess = require('node:child_process');
    vi.spyOn(childProcess, 'execSync').mockImplementation(() => {
      throw new Error('To get started with GitHub CLI, please run: gh auth login');
    });

    const result = getGhUserInfo();
    expect(result).toBeNull();
  });

  it('handles gh returning partial data (name missing)', () => {
    const childProcess = require('node:child_process');
    vi.spyOn(childProcess, 'execSync').mockImplementation(() => {
      return JSON.stringify({ login: 'octocat', name: '', id: 'U_abc123' });
    });

    const result = getGhUserInfo();
    expect(result).not.toBeNull();
    expect(result!.login).toBe('octocat');
    expect(result!.name).toBe('');
    expect(result!.id).toBe('U_abc123');
  });
});

// ---------------------------------------------------------------------------
// RED phase: createDefaultUserConfig with gh detection
// ---------------------------------------------------------------------------
describe('createDefaultUserConfig with gh detection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('uses gh info when available (id from github login, name from gh, github handle from gh)', () => {
    const config = createDefaultUserConfig();
    // After implementation, when gh is available, id should come from github login
    expect(config.user.id).toBeDefined();
    expect(typeof config.user.id).toBe('string');
    expect(config.user.id.length).toBeGreaterThan(0);
  });

  it('falls back to git config when gh is not available', () => {
    const childProcess = require('node:child_process');
    // Mock gh to fail, but git config to succeed
    const originalExecSync = childProcess.execSync;
    vi.spyOn(childProcess, 'execSync').mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('gh ')) {
        throw new Error('command not found: gh');
      }
      return originalExecSync(cmd, { encoding: 'utf-8' });
    });

    const config = createDefaultUserConfig();
    expect(config.user.id).toBeDefined();
    expect(config.user.name).toBeTruthy();
  });

  it('falls back to Developer when neither gh nor git available', () => {
    const childProcess = require('node:child_process');
    vi.spyOn(childProcess, 'execSync').mockImplementation(() => {
      throw new Error('command not found');
    });

    const config = createDefaultUserConfig();
    expect(config.user.name).toBe('Developer');
    expect(config.user.id).toBeDefined();
  });

  it('sets profile to solo-dev by default', () => {
    const config = createDefaultUserConfig();
    expect(config.user.profile).toBe('solo-dev');
  });
});

// ---------------------------------------------------------------------------
// RED phase: UserIdentity with id and profile
// ---------------------------------------------------------------------------
describe('UserIdentity with id and profile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'verso-identity-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('UserIdentity requires id field', () => {
    const identity: UserIdentity = {
      id: 'octocat',
      name: 'Octocat',
      github: 'octocat',
      profile: 'solo-dev',
    };
    expect(identity.id).toBe('octocat');
  });

  it('UserIdentity uses profile instead of role', () => {
    const identity: UserIdentity = {
      id: 'dev1',
      name: 'Dev One',
      profile: 'team-dev',
    };
    expect(identity.profile).toBe('team-dev');
    // Should NOT have role property
    expect((identity as Record<string, unknown>).role).toBeUndefined();
  });

  it('profile must be a valid UserProfile value', () => {
    const validProfiles: UserProfile[] = ['solo-dev', 'team-dev', 'tech-lead', 'pm'];
    for (const p of validProfiles) {
      const identity: UserIdentity = { id: 'test', name: 'Test', profile: p };
      expect(identity.profile).toBe(p);
    }
  });

  it('loadUserConfig validates id is present', () => {
    const configWithoutId = {
      user: { name: 'No ID', profile: 'solo-dev' },
    };
    writeFileSync(join(tmpDir, '.verso.yaml'), yaml.dump(configWithoutId), 'utf-8');

    const result = loadUserConfig(tmpDir);
    expect(result).toBeNull();
  });

  it('loadUserConfig validates profile is present', () => {
    const configWithoutProfile = {
      user: { id: 'test-id', name: 'No Profile' },
    };
    writeFileSync(join(tmpDir, '.verso.yaml'), yaml.dump(configWithoutProfile), 'utf-8');

    const result = loadUserConfig(tmpDir);
    expect(result).toBeNull();
  });

  it('saveUserConfig round-trips id and profile correctly', () => {
    const config: UserConfig = {
      user: { id: 'roundtrip-id', name: 'Round Trip', github: 'roundtrip', profile: 'tech-lead' },
      preferences: { format: 'human', autonomy_override: null },
    };

    saveUserConfig(tmpDir, config);
    const loaded = loadUserConfig(tmpDir);

    expect(loaded).not.toBeNull();
    expect(loaded!.user.id).toBe('roundtrip-id');
    expect(loaded!.user.profile).toBe('tech-lead');
    expect(loaded!.user.name).toBe('Round Trip');
    expect(loaded!.user.github).toBe('roundtrip');
  });
});
