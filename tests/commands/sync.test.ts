import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import { loadConfig, defaultConfig } from '../../src/core/config.js';
import { applySyncActions } from '../../src/core/plugin-loader.js';
import { createDefaultItem } from '../../src/core/types.js';
import type { BoardFile, State } from '../../src/core/types.js';

const CLI = path.join(__dirname, '..', '..', 'src', 'index.ts');

function verso(dir: string, args: string): string {
  return execSync(`cd "${dir}" && npx tsx "${CLI}" ${args}`, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function createTestBoard(items: Array<{ id: number; state: State; title?: string }>): BoardFile {
  return {
    schema_version: 1,
    items: items.map(({ id, state, title }) =>
      createDefaultItem({ id, state, title: title || `Item ${id}` }),
    ),
  };
}

describe('verso sync command', { timeout: 30_000 }, () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verso-sync-test-'));
    verso(tmpDir, 'init --defaults');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('sync with no board plugin prints helpful message', () => {
    const out = verso(tmpDir, 'sync --format json');
    const result = JSON.parse(out);
    expect(result.error).toContain('No board plugin configured');
  });

  it('sync push with no board plugin prints helpful message', () => {
    const out = verso(tmpDir, 'sync push --format json');
    const result = JSON.parse(out);
    expect(result.error).toContain('No board plugin configured');
  });

  it('sync pull with no board plugin prints helpful message', () => {
    const out = verso(tmpDir, 'sync pull --format json');
    const result = JSON.parse(out);
    expect(result.error).toContain('No board plugin configured');
  });

  it('sync pull --dry-run with no board plugin prints helpful message', () => {
    const out = verso(tmpDir, 'sync pull --dry-run --format json');
    const result = JSON.parse(out);
    expect(result.error).toContain('No board plugin configured');
  });
});

describe('config backward compatibility', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verso-config-plugins-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('config without plugins field still loads correctly', () => {
    // Write a config without the plugins field
    const config = defaultConfig();
    const { plugins: _plugins, ...configWithoutPlugins } = config;
    const yamlStr = yaml.dump(configWithoutPlugins, { lineWidth: -1, noRefs: true });
    fs.writeFileSync(path.join(tmpDir, 'config.yaml'), yamlStr);

    const loaded = loadConfig(tmpDir);
    // Should load without error and have defaults merged in
    expect(loaded.schema_version).toBe(2);
    expect(loaded.scale).toBe('solo');
    // plugins comes from defaultConfig merge
    expect(loaded.plugins).toBeDefined();
  });

  it('config with plugins field loads correctly', () => {
    const config = {
      ...defaultConfig(),
      plugins: { board: 'github', review: 'github-review' },
    };
    const yamlStr = yaml.dump(config, { lineWidth: -1, noRefs: true });
    fs.writeFileSync(path.join(tmpDir, 'config.yaml'), yamlStr);

    const loaded = loadConfig(tmpDir);
    expect(loaded.plugins).toBeDefined();
    expect(loaded.plugins!.board).toBe('github');
    expect(loaded.plugins!.review).toBe('github-review');
  });
});
