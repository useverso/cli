import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = join(__dirname, '..', '..', 'src', 'index.ts');

function verso(dir: string, args: string): string {
  return execSync(`cd "${dir}" && npx tsx "${CLI}" ${args}`, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

describe('plugin backward compatibility', { timeout: 30_000 }, () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'verso-plugin-compat-'));
    verso(tmpDir, 'init --defaults');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('doctor works without plugins', () => {
    const out = verso(tmpDir, 'doctor --format json');
    const result = JSON.parse(out);
    expect(result.has_failures).toBe(false);
    expect(result.checks.length).toBeGreaterThan(0);
  });

  it('status works without plugins', () => {
    verso(tmpDir, 'board add -t feature --title "Test item"');
    const out = verso(tmpDir, 'status --format json');
    const status = JSON.parse(out);
    expect(status.total).toBe(1);
    expect(status.counts.captured).toBe(1);
  });

  it('ship works without review plugin', () => {
    verso(tmpDir, 'board add -t feature --title "Ship no plugin"');
    verso(tmpDir, 'board move 1 --to refined --trigger spec_approved');
    verso(tmpDir, 'board move 1 --to queued --trigger priority_set');
    verso(tmpDir, 'build start 1');
    verso(tmpDir, 'review start 1');
    verso(tmpDir, 'review submit 1 --verdict approve --summary "OK"');
    const out = verso(tmpDir, 'ship 1 --format json');
    const item = JSON.parse(out);
    expect(item.state).toBe('done');
  });

  it('review start works without review plugin', () => {
    verso(tmpDir, 'board add -t feature --title "Review no plugin"');
    verso(tmpDir, 'board move 1 --to refined --trigger spec_approved');
    verso(tmpDir, 'board move 1 --to queued --trigger priority_set');
    verso(tmpDir, 'build start 1');
    const out = verso(tmpDir, 'review start 1 --format json');
    const item = JSON.parse(out);
    expect(item.state).toBe('verifying');
  });
});
