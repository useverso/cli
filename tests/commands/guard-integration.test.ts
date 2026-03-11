import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';

const CLI = join(__dirname, '..', '..', 'src', 'index.ts');

/** Run a verso CLI command inside the given directory, return stdout */
function verso(dir: string, args: string): string {
  return execSync(`cd "${dir}" && npx tsx "${CLI}" ${args}`, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/** Run a verso CLI command expecting failure, return combined output */
function versoFail(dir: string, args: string): string {
  try {
    execSync(`cd "${dir}" && npx tsx "${CLI}" ${args}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return '';
  } catch (err: unknown) {
    const e = err as { stderr?: string; stdout?: string };
    return (e.stderr ?? '') + (e.stdout ?? '');
  }
}

/** Write a custom config.yaml to the .verso dir */
function writeConfig(dir: string, overrides: Record<string, unknown>): void {
  const configPath = join(dir, '.verso', 'config.yaml');
  const existing = yaml.load(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
  const merged = { ...existing, ...overrides };
  writeFileSync(configPath, yaml.dump(merged, { lineWidth: -1, noRefs: true }), 'utf-8');
}

describe('guard integration through commands', { timeout: 30_000 }, () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'verso-guard-test-'));
    verso(tmpDir, 'init --defaults');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // --- 1. board move to building respects WIP limit ---
  it('board move to building respects WIP limit', () => {
    // Set WIP building limit to 1
    writeConfig(tmpDir, { wip: { building: 1, pr_ready: 5 } });

    // Create and move first item to building
    verso(tmpDir, 'board add -t feature --title "Item 1"');
    verso(tmpDir, 'board move 1 --to refined --trigger spec_written');
    verso(tmpDir, 'board move 1 --to queued --trigger breakdown_complete');
    verso(tmpDir, 'board move 1 --to building --trigger builder_spawned');

    // Create and try to move second item to building — should fail
    verso(tmpDir, 'board add -t feature --title "Item 2"');
    verso(tmpDir, 'board move 2 --to refined --trigger spec_written');
    verso(tmpDir, 'board move 2 --to queued --trigger breakdown_complete');
    const out = versoFail(tmpDir, 'board move 2 --to building --trigger builder_spawned');
    expect(out).toContain('WIP limit');

    // Verify item 2 is still queued
    const show = verso(tmpDir, 'board show 2 --format json');
    expect(JSON.parse(show).state).toBe('queued');
  });

  // --- 2. board move as captain bypasses autonomy ---
  it('board move as captain bypasses autonomy checks', () => {
    // Set autonomy for feature to 1 (most restrictive)
    writeConfig(tmpDir, {
      autonomy: { feature: 1, bug: 1, hotfix: 1, refactor: 1, chore: 1 },
    });

    verso(tmpDir, 'board add -t feature --title "Captain move"');
    // Captain (default actor for board move) should bypass autonomy
    const out = verso(tmpDir, 'board move 1 --to refined --trigger spec_written --format json');
    const item = JSON.parse(out);
    expect(item.state).toBe('refined');
  });

  // --- 3. build start respects WIP (without separate checkWipGuard call) ---
  it('build start respects WIP limit', () => {
    writeConfig(tmpDir, { wip: { building: 1, pr_ready: 5 } });

    // Move first item all the way to building
    verso(tmpDir, 'board add -t feature --title "Item 1"');
    verso(tmpDir, 'board move 1 --to refined --trigger spec_written');
    verso(tmpDir, 'board move 1 --to queued --trigger breakdown_complete');
    verso(tmpDir, 'build start 1');

    // Second item should fail at build start due to WIP
    verso(tmpDir, 'board add -t feature --title "Item 2"');
    verso(tmpDir, 'board move 2 --to refined --trigger spec_written');
    verso(tmpDir, 'board move 2 --to queued --trigger breakdown_complete');
    const out = versoFail(tmpDir, 'build start 2');
    expect(out).toContain('WIP limit');

    // Verify item 2 is still queued
    const show = verso(tmpDir, 'board show 2 --format json');
    expect(JSON.parse(show).state).toBe('queued');
  });

  // --- 4. build fail at retry limit moves to blocked ---
  it('build fail at retry limit moves to blocked', () => {
    // Set max retries to 1
    writeConfig(tmpDir, { build: { max_retries: 1 } });

    verso(tmpDir, 'board add -t feature --title "Retry test"');
    verso(tmpDir, 'board move 1 --to refined --trigger spec_written');
    verso(tmpDir, 'board move 1 --to queued --trigger breakdown_complete');

    // First build + fail: retries goes from 0 to 1
    verso(tmpDir, 'build start 1');
    verso(tmpDir, 'build fail 1 --reason "first failure"');

    // Item should be back in queued with retries = 1
    let show = verso(tmpDir, 'board show 1 --format json');
    let item = JSON.parse(show);
    expect(item.state).toBe('queued');
    expect(item.retries).toBe(1);

    // Second build + fail: retries = 1 >= max_retries = 1 -> blocked
    verso(tmpDir, 'build start 1');
    const out = verso(tmpDir, 'build fail 1 --reason "second failure" --format json');
    item = JSON.parse(out);
    expect(item.state).toBe('blocked');
    expect(item.blocked_reason).toContain('Max retries exceeded');
  });

  // --- 5. review submit respects review round limit ---
  it('review submit respects review round limit', () => {
    writeConfig(tmpDir, { review: { max_rounds: 2 } });

    verso(tmpDir, 'board add -t feature --title "Review rounds"');
    verso(tmpDir, 'board move 1 --to refined --trigger spec_written');
    verso(tmpDir, 'board move 1 --to queued --trigger breakdown_complete');
    verso(tmpDir, 'build start 1');
    verso(tmpDir, 'review start 1');

    // First review round: request changes
    verso(tmpDir, 'review submit 1 --verdict request-changes --summary "Round 1"');

    // Rebuild and review again
    verso(tmpDir, 'review start 1');
    verso(tmpDir, 'review submit 1 --verdict request-changes --summary "Round 2"');

    // Third attempt should fail — 2 reviews already recorded, max_rounds = 2
    verso(tmpDir, 'review start 1');
    const out = versoFail(tmpDir, 'review submit 1 --verdict request-changes --summary "Round 3"');
    expect(out).toContain('review rounds');
    expect(out).toContain('escalate required');
  });

  // --- 6. ship as pilot blocked by autonomy level 3 ---
  it('ship as pilot blocked by autonomy level 3', () => {
    // Default autonomy for feature is 2, which blocks pr_ready->done for non-captain
    // But we use board move (as captain) to get to pr_ready, then try ship with --actor pilot
    // Actually, the ship command always uses actor 'captain', so let's test via board move
    writeConfig(tmpDir, {
      autonomy: { feature: 3, bug: 3, hotfix: 3, refactor: 3, chore: 4 },
    });

    verso(tmpDir, 'board add -t feature --title "Ship test"');
    verso(tmpDir, 'board move 1 --to refined --trigger spec_written');
    verso(tmpDir, 'board move 1 --to queued --trigger breakdown_complete');
    verso(tmpDir, 'build start 1');
    verso(tmpDir, 'review start 1');
    verso(tmpDir, 'review submit 1 --verdict approve --summary "LGTM"');

    // Try board move to done as pilot at autonomy 3 — should be blocked
    const out = versoFail(tmpDir, 'board move 1 --to done --trigger pr_merged --actor pilot');
    expect(out).toContain('approval');

    // Verify still in pr_ready
    const show = verso(tmpDir, 'board show 1 --format json');
    expect(JSON.parse(show).state).toBe('pr_ready');
  });
});
