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

describe('verso metrics', { timeout: 30_000 }, () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'verso-metrics-test-'));
    verso(tmpDir, 'init --defaults');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── empty board ──────────────────────────────────────
  it('handles empty board gracefully', () => {
    const out = verso(tmpDir, 'metrics --format json');
    const m = JSON.parse(out);

    expect(m.throughput.done).toBe(0);
    expect(m.throughput.total).toBe(0);
    expect(m.throughput.percentage).toBe(0);
    expect(m.agentEffort.totalSessions).toBe(0);
    expect(m.retryRate.totalRetries).toBe(0);
    expect(m.byWorkType).toEqual([]);
  });

  // ── throughput with items ────────────────────────────
  it('calculates throughput with mixed states', () => {
    verso(tmpDir, 'board add -t feature --title "Item one"');
    verso(tmpDir, 'board add -t feature --title "Item two"');
    verso(tmpDir, 'board add -t bug --title "Item three"');

    // Move item 1 all the way to done
    verso(tmpDir, 'board move 1 --to refined --trigger spec_written');
    verso(tmpDir, 'board move 1 --to queued --trigger breakdown_complete');
    verso(tmpDir, 'build start 1');
    verso(tmpDir, 'review start 1');
    verso(tmpDir, 'board move 1 --to pr_ready --trigger review_passed');
    verso(tmpDir, 'board move 1 --to done --trigger merged');

    const out = verso(tmpDir, 'metrics --format json');
    const m = JSON.parse(out);

    expect(m.throughput.done).toBe(1);
    expect(m.throughput.total).toBe(3);
    expect(m.throughput.percentage).toBe(33);
  });

  // ── cycle time ───────────────────────────────────────
  it('computes cycle time for done items', () => {
    verso(tmpDir, 'board add -t feature --title "Cycle test"');
    verso(tmpDir, 'board move 1 --to refined --trigger spec_written');
    verso(tmpDir, 'board move 1 --to queued --trigger breakdown_complete');
    verso(tmpDir, 'build start 1');
    verso(tmpDir, 'review start 1');
    verso(tmpDir, 'board move 1 --to pr_ready --trigger review_passed');
    verso(tmpDir, 'board move 1 --to done --trigger merged');

    const out = verso(tmpDir, 'metrics --format json');
    const m = JSON.parse(out);

    // Cycle time should be > 0 (even if tiny since tests run fast)
    expect(m.cycleTime.count).toBe(1);
    expect(m.cycleTime.avgHours).toBeGreaterThanOrEqual(0);
  });

  // ── filter by work type ──────────────────────────────
  it('filters metrics by work type', () => {
    verso(tmpDir, 'board add -t feature --title "Feature one"');
    verso(tmpDir, 'board add -t feature --title "Feature two"');
    verso(tmpDir, 'board add -t bug --title "Bug one"');
    verso(tmpDir, 'board add -t chore --title "Chore one"');

    const out = verso(tmpDir, 'metrics --type feature --format json');
    const m = JSON.parse(out);

    expect(m.throughput.total).toBe(2);
    // byWorkType should only contain feature
    expect(m.byWorkType).toHaveLength(1);
    expect(m.byWorkType[0].type).toBe('feature');
  });

  // ── JSON format returns parseable JSON with all keys ─
  it('returns parseable JSON with all expected keys', () => {
    verso(tmpDir, 'board add -t feature --title "JSON test"');

    const out = verso(tmpDir, 'metrics --format json');
    const m = JSON.parse(out);

    expect(m).toHaveProperty('throughput');
    expect(m).toHaveProperty('cycleTime');
    expect(m).toHaveProperty('agentEffort');
    expect(m).toHaveProperty('retryRate');
    expect(m).toHaveProperty('reviewEfficiency');
    expect(m).toHaveProperty('byState');
    expect(m).toHaveProperty('byWorkType');
    expect(m).toHaveProperty('costs');

    expect(typeof m.throughput.done).toBe('number');
    expect(typeof m.throughput.total).toBe('number');
    expect(typeof m.throughput.percentage).toBe('number');
    expect(typeof m.cycleTime.avgHours).toBe('number');
    expect(typeof m.agentEffort.totalSessions).toBe('number');
  });

  // ── by state counts ─────────────────────────────────
  it('shows correct by-state counts', () => {
    verso(tmpDir, 'board add -t feature --title "Captured item"');
    verso(tmpDir, 'board add -t bug --title "Refined item"');
    verso(tmpDir, 'board move 2 --to refined --trigger spec_written');

    const out = verso(tmpDir, 'metrics --format json');
    const m = JSON.parse(out);

    expect(m.byState.captured).toBe(1);
    expect(m.byState.refined).toBe(1);
    expect(m.byState.done).toBe(0);
  });
});
