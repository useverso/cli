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

describe('verso status', { timeout: 30_000 }, () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'verso-status-test-'));
    verso(tmpDir, 'init --defaults');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── item counts per state ──────────────────────────────
  it('shows correct item counts per state', () => {
    verso(tmpDir, 'board add -t feature --title "In captured"');
    verso(tmpDir, 'board add -t feature --title "Also captured"');
    verso(tmpDir, 'board add -t feature --title "Will cancel"');
    verso(tmpDir, 'board cancel 3 --reason "not needed"');

    const out = verso(tmpDir, 'status --format json');
    const status = JSON.parse(out);

    expect(status.counts.captured).toBe(2);
    expect(status.counts.cancelled).toBe(1);
    expect(status.counts.done).toBe(0);
    expect(status.counts.building).toBe(0);
    expect(status.counts.verifying).toBe(0);
    expect(status.counts.pr_ready).toBe(0);
    expect(status.counts.queued).toBe(0);
    expect(status.counts.refined).toBe(0);
    expect(status.counts.blocked).toBe(0);
    expect(status.total).toBe(3);
  });

  // ── WIP limits ─────────────────────────────────────────
  it('shows WIP limits with current and max', () => {
    // Add items and move one to building
    verso(tmpDir, 'board add -t feature --title "Building item"');
    verso(tmpDir, 'board move 1 --to refined --trigger spec_written');
    verso(tmpDir, 'board move 1 --to queued --trigger breakdown_complete');
    verso(tmpDir, 'build start 1');

    const out = verso(tmpDir, 'status --format json');
    const status = JSON.parse(out);

    expect(status.wip.building.current).toBe(1);
    expect(status.wip.building.max).toBe(2); // default solo WIP limit
    expect(status.wip.pr_ready.current).toBe(0);
    expect(status.wip.pr_ready.max).toBe(5); // default solo WIP limit
  });

  // ── active items ───────────────────────────────────────
  it('shows active items in building and verifying states', () => {
    // Create and move item to building
    verso(tmpDir, 'board add -t feature --title "Active builder"');
    verso(tmpDir, 'board move 1 --to refined --trigger spec_written');
    verso(tmpDir, 'board move 1 --to queued --trigger breakdown_complete');
    verso(tmpDir, 'build start 1 --assignee builder-agent');

    // Create and move another item to verifying
    verso(tmpDir, 'board add -t bug --title "Under review"');
    verso(tmpDir, 'board move 2 --to refined --trigger spec_written');
    verso(tmpDir, 'board move 2 --to queued --trigger breakdown_complete');
    verso(tmpDir, 'build start 2');
    verso(tmpDir, 'review start 2');

    // A third item stays in captured (should NOT appear in active)
    verso(tmpDir, 'board add -t chore --title "Not active"');

    const out = verso(tmpDir, 'status --format json');
    const status = JSON.parse(out);

    expect(status.active).toHaveLength(2);

    const buildingItem = status.active.find((a: { id: number }) => a.id === 1);
    expect(buildingItem).toBeDefined();
    expect(buildingItem.title).toBe('Active builder');
    expect(buildingItem.state).toBe('building');
    expect(buildingItem.assignee).toBe('builder-agent');

    const verifyingItem = status.active.find((a: { id: number }) => a.id === 2);
    expect(verifyingItem).toBeDefined();
    expect(verifyingItem.title).toBe('Under review');
    expect(verifyingItem.state).toBe('verifying');
  });

  // ── empty board ────────────────────────────────────────
  it('handles empty board gracefully', () => {
    const out = verso(tmpDir, 'status --format json');
    const status = JSON.parse(out);

    expect(status.total).toBe(0);
    expect(status.active).toEqual([]);
    expect(status.blocked).toEqual([]);
    expect(status.counts.captured).toBe(0);
    expect(status.counts.building).toBe(0);
    expect(status.wip.building.current).toBe(0);
    expect(status.wip.pr_ready.current).toBe(0);
  });

  // ── --format json returns parseable JSON ───────────────
  it('--format json returns parseable JSON with all status data', () => {
    verso(tmpDir, 'board add -t feature --title "JSON test"');

    const out = verso(tmpDir, 'status --format json');
    const status = JSON.parse(out);

    // Verify all expected top-level keys exist
    expect(status).toHaveProperty('counts');
    expect(status).toHaveProperty('wip');
    expect(status).toHaveProperty('active');
    expect(status).toHaveProperty('blocked');
    expect(status).toHaveProperty('total');

    // Verify structure of nested objects
    expect(status.wip).toHaveProperty('building');
    expect(status.wip).toHaveProperty('pr_ready');
    expect(status.wip.building).toHaveProperty('current');
    expect(status.wip.building).toHaveProperty('max');
    expect(status.wip.pr_ready).toHaveProperty('current');
    expect(status.wip.pr_ready).toHaveProperty('max');

    // Verify types
    expect(typeof status.total).toBe('number');
    expect(Array.isArray(status.active)).toBe(true);
    expect(Array.isArray(status.blocked)).toBe(true);
  });

  // ── blocked items with reasons ─────────────────────────
  it('shows blocked items with reasons', () => {
    // Create and move item to blocked
    verso(tmpDir, 'board add -t feature --title "Blocked feature"');
    verso(tmpDir, 'board move 1 --to refined --trigger spec_written');
    verso(tmpDir, 'board move 1 --to queued --trigger breakdown_complete');
    verso(tmpDir, 'board move 1 --to blocked --reason "waiting for API key"');

    // Create another blocked item
    verso(tmpDir, 'board add -t bug --title "Blocked bug"');
    verso(tmpDir, 'board move 2 --to refined --trigger spec_written');
    verso(tmpDir, 'board move 2 --to queued --trigger breakdown_complete');
    verso(tmpDir, 'board move 2 --to blocked --reason "depends on infra team"');

    // A non-blocked item
    verso(tmpDir, 'board add -t chore --title "Not blocked"');

    const out = verso(tmpDir, 'status --format json');
    const status = JSON.parse(out);

    expect(status.blocked).toHaveLength(2);
    expect(status.counts.blocked).toBe(2);

    const blockedFeature = status.blocked.find((b: { id: number }) => b.id === 1);
    expect(blockedFeature).toBeDefined();
    expect(blockedFeature.title).toBe('Blocked feature');
    expect(blockedFeature.reason).toBe('waiting for API key');

    const blockedBug = status.blocked.find((b: { id: number }) => b.id === 2);
    expect(blockedBug).toBeDefined();
    expect(blockedBug.title).toBe('Blocked bug');
    expect(blockedBug.reason).toBe('depends on infra team');
  });

  // ── config in JSON output ────────────────────────────────
  it('verso status --format json includes config.scale', () => {
    const out = verso(tmpDir, 'status --format json');
    const status = JSON.parse(out);

    expect(status).toHaveProperty('config');
    expect(status.config.scale).toBe('solo');
  });

  it('verso status --format json includes config.autonomy with all work types', () => {
    const out = verso(tmpDir, 'status --format json');
    const status = JSON.parse(out);

    expect(status.config.autonomy).toEqual({
      feature: 2,
      bug: 3,
      hotfix: 3,
      refactor: 2,
      chore: 4,
    });
  });

  it('verso status --format json includes config.quality', () => {
    const out = verso(tmpDir, 'status --format json');
    const status = JSON.parse(out);

    expect(status.config.quality).toBeDefined();
    expect(status.config.quality.security_gate).toBe('warn');
    expect(status.config.quality.accessibility_gate).toBe('warn');
    expect(status.config.quality.min_coverage).toBe(80);
    expect(status.config.quality.require_tests).toBe(true);
  });

  it('verso status --format json includes config with ci, board, review, build, debt', () => {
    const out = verso(tmpDir, 'status --format json');
    const status = JSON.parse(out);

    expect(status.config.ci.required_checks).toEqual(['typecheck', 'tests', 'lint']);
    expect(status.config.ci.block_transition).toBe(true);
    expect(status.config.board.provider).toBe('local');
    expect(status.config.review.max_rounds).toBe(3);
    expect(status.config.build.max_retries).toBe(3);
    expect(status.config.debt.target_ratio).toBe(0.2);
  });

  // ── roadmap in JSON output ───────────────────────────────
  it('verso status --format json includes roadmap.vision', () => {
    const out = verso(tmpDir, 'status --format json');
    const status = JSON.parse(out);

    expect(status).toHaveProperty('roadmap');
    expect(status.roadmap).toHaveProperty('vision');
  });

  it('verso status --format json includes roadmap.horizons', () => {
    const out = verso(tmpDir, 'status --format json');
    const status = JSON.parse(out);

    expect(status.roadmap.horizons).toBeDefined();
    expect(status.roadmap.horizons.now).toBeDefined();
    expect(status.roadmap.horizons.now.milestone).toBe('mvp');
  });

  it('verso status --format json includes roadmap.milestones', () => {
    const out = verso(tmpDir, 'status --format json');
    const status = JSON.parse(out);

    expect(status.roadmap.milestones).toBeDefined();
    expect(status.roadmap.milestones.mvp).toBeDefined();
    expect(status.roadmap.milestones.mvp.name).toBe('MVP');
    expect(status.roadmap.milestones.mvp.status).toBe('planned');
  });
});
