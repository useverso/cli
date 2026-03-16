import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = join(__dirname, 'config-cli.ts');

function verso(dir: string, args: string): string {
  return execSync(`cd "${dir}" && npx tsx "${CLI}" ${args}`, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function versoFails(dir: string, args: string): { stderr: string; code: number } {
  try {
    execSync(`cd "${dir}" && npx tsx "${CLI}" ${args}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stderr: '', code: 0 };
  } catch (err: unknown) {
    const e = err as { status: number; stderr: string };
    return { stderr: e.stderr, code: e.status };
  }
}

describe('verso config get', { timeout: 30_000 }, () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'verso-config-test-'));
    verso(tmpDir, 'init --defaults');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── full config dump ──────────────────────────────────
  it('dumps full config as JSON when no key is given', () => {
    const out = verso(tmpDir, 'config get --format json');
    const config = JSON.parse(out);

    expect(config).toHaveProperty('schema_version');
    expect(config).toHaveProperty('scale');
    expect(config).toHaveProperty('autonomy');
    expect(config).toHaveProperty('wip');
    expect(config.schema_version).toBe(2);
    expect(config.scale).toBe('solo');
  });

  // ── top-level scalar key ──────────────────────────────
  it('returns scalar value for top-level key "scale"', () => {
    const out = verso(tmpDir, 'config get scale --format json');
    const value = JSON.parse(out);

    expect(value).toBe('solo');
  });

  // ── top-level object key ──────────────────────────────
  it('returns object for top-level key "autonomy"', () => {
    const out = verso(tmpDir, 'config get autonomy --format json');
    const value = JSON.parse(out);

    expect(value).toHaveProperty('feature');
    expect(value).toHaveProperty('bug');
    expect(value).toHaveProperty('hotfix');
    expect(value.feature).toBe(2);
    expect(value.bug).toBe(3);
  });

  // ── dot-notation nested key ───────────────────────────
  it('returns nested value for "autonomy.feature"', () => {
    const out = verso(tmpDir, 'config get autonomy.feature --format json');
    const value = JSON.parse(out);

    expect(value).toBe(2);
  });

  // ── dot-notation nested key (wip) ─────────────────────
  it('returns nested value for "wip.building"', () => {
    const out = verso(tmpDir, 'config get wip.building --format json');
    const value = JSON.parse(out);

    expect(value).toBe(2);
  });

  // ── nonexistent top-level key ─────────────────────────
  it('fails with error for nonexistent top-level key', () => {
    const result = versoFails(tmpDir, 'config get nonexistent --format json');

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('nonexistent');
  });

  // ── nonexistent nested key ────────────────────────────
  it('fails with error for nonexistent nested key', () => {
    const result = versoFails(tmpDir, 'config get autonomy.nonexistent --format json');

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('autonomy.nonexistent');
  });

  // ── --format plain for scalar ─────────────────────────
  it('outputs plain format for scalar value', () => {
    const out = verso(tmpDir, 'config get scale --format plain');

    expect(out.trim()).toBe('scale: solo');
  });

  // ── --format plain for nested scalar ──────────────────
  it('outputs plain format for nested scalar value', () => {
    const out = verso(tmpDir, 'config get autonomy.feature --format plain');

    expect(out.trim()).toBe('autonomy.feature: 2');
  });

  // ── --format plain for object ─────────────────────────
  it('outputs YAML for object in plain format', () => {
    const out = verso(tmpDir, 'config get wip --format plain');

    expect(out).toContain('building:');
    expect(out).toContain('pr_ready:');
  });

  // ── --format human for full dump ──────────────────────
  it('outputs YAML for full config dump in human format', () => {
    const out = verso(tmpDir, 'config get --format human');

    expect(out).toContain('schema_version:');
    expect(out).toContain('scale:');
    expect(out).toContain('autonomy:');
  });
});
