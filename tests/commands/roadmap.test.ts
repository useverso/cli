import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = join(__dirname, '..', '..', 'src', 'index.ts');

function verso(dir: string, args: string): string {
  return execSync(`cd "${dir}" && npx tsx "${CLI}" ${args}`, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

describe('verso roadmap show', { timeout: 30_000 }, () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'verso-roadmap-test-'));
    verso(tmpDir, 'init --defaults');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── JSON format ──────────────────────────────────────────

  it('--format json returns parseable JSON with vision, horizons, milestones', () => {
    const out = verso(tmpDir, 'roadmap show --format json');
    const roadmap = JSON.parse(out);

    expect(roadmap).toHaveProperty('vision');
    expect(roadmap).toHaveProperty('horizons');
    expect(roadmap).toHaveProperty('milestones');
    expect(roadmap).toHaveProperty('schema_version');
  });

  it('JSON output has horizons.now.milestone', () => {
    const out = verso(tmpDir, 'roadmap show --format json');
    const roadmap = JSON.parse(out);

    expect(roadmap.horizons).toHaveProperty('now');
    expect(roadmap.horizons.now).toHaveProperty('milestone');
    expect(roadmap.horizons.now.milestone).toBe('mvp');
  });

  it('JSON output has milestones with criteria', () => {
    const out = verso(tmpDir, 'roadmap show --format json');
    const roadmap = JSON.parse(out);

    expect(roadmap.milestones).toHaveProperty('mvp');
    expect(roadmap.milestones.mvp).toHaveProperty('name');
    expect(roadmap.milestones.mvp).toHaveProperty('status');
    expect(roadmap.milestones.mvp).toHaveProperty('criteria');
    expect(Array.isArray(roadmap.milestones.mvp.criteria)).toBe(true);
  });

  // ── Works on fresh init ──────────────────────────────────

  it('works on freshly initialized project', () => {
    expect(existsSync(join(tmpDir, '.verso', 'roadmap.yaml'))).toBe(true);

    const out = verso(tmpDir, 'roadmap show --format json');
    const roadmap = JSON.parse(out);

    expect(roadmap.schema_version).toBe(1);
    expect(roadmap.horizons.now.milestone).toBe('mvp');
    expect(roadmap.horizons.next.milestone).toBe('polish');
    expect(roadmap.milestones.mvp.status).toBe('planned');
  });

  // ── Plain format ─────────────────────────────────────────

  it('--format plain outputs vision and horizon info', () => {
    const out = verso(tmpDir, 'roadmap show --format plain');

    expect(out).toContain('vision:');
    expect(out).toContain('now_milestone: mvp');
    expect(out).toContain('next_milestone: polish');
  });

  // ── Fails gracefully without .verso/ ─────────────────────

  it('fails gracefully when .verso/ does not exist', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'verso-roadmap-empty-'));
    try {
      expect(() => {
        verso(emptyDir, 'roadmap show --format json');
      }).toThrow();
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
