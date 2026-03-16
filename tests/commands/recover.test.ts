import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';

const CLI = join(__dirname, '..', '..', 'src', 'index.ts');
const RECOVER_ENTRY = join(__dirname, '..', 'helpers', 'recover-entry.ts');

/** Run a verso CLI command inside the given directory, return stdout */
function verso(dir: string, args: string): string {
  return execSync(`cd "${dir}" && npx tsx "${CLI}" ${args}`, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/** Run recover command through a test entry point that registers the recover command */
function versoRecover(dir: string, args: string): string {
  return execSync(`cd "${dir}" && npx tsx "${RECOVER_ENTRY}" ${args}`, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

interface RecoveryIssue {
  itemId: number;
  title: string;
  state: string;
  issueType: 'orphaned_build' | 'stale_review' | 'empty_blocked_reason';
  suggestedAction: string;
}

function recoverJson(dir: string, extraArgs = ''): RecoveryIssue[] {
  const out = versoRecover(dir, `recover --format json ${extraArgs}`);
  return JSON.parse(out);
}

function makeBoard(items: Record<string, unknown>[]): string {
  return yaml.dump({ schema_version: 2, items });
}

function readBoard(dir: string): { schema_version: number; items: Record<string, unknown>[] } {
  const content = readFileSync(join(dir, '.verso', 'board.yaml'), 'utf-8');
  return yaml.load(content) as { schema_version: number; items: Record<string, unknown>[] };
}

const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

function baseItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
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
    created_at: now,
    updated_at: now,
    labels: [],
    transitions: [],
    reviews: [],
    external: {},
    description: '',
    spec_path: '',
    blocked_by: [],
    blocked_reason: '',
    milestone: '',
    costs: {
      tokens_in: 0,
      tokens_out: 0,
      api_cost: 0,
      agent_wall_time: 0,
      dev_gate_time: 0,
      dev_review_time: 0,
    },
    ...overrides,
  };
}

describe('verso recover', { timeout: 30_000 }, () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'verso-recover-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Healthy board ──────────────────────────────────────────
  it('returns empty array when board is healthy', () => {
    verso(tmpDir, 'init --defaults');
    // Add a normal captured item
    writeFileSync(
      join(tmpDir, '.verso', 'board.yaml'),
      makeBoard([baseItem({ id: 1, title: 'Healthy item', state: 'captured' })]),
    );

    const issues = recoverJson(tmpDir);
    expect(issues).toEqual([]);
  });

  // ── Orphaned build detection ───────────────────────────────
  it('detects building item with no matching worktree', () => {
    verso(tmpDir, 'init --defaults');
    writeFileSync(
      join(tmpDir, '.verso', 'board.yaml'),
      makeBoard([baseItem({ id: 1, title: 'Build orphan', state: 'building' })]),
    );

    const issues = recoverJson(tmpDir);
    expect(issues).toHaveLength(1);
    expect(issues[0].itemId).toBe(1);
    expect(issues[0].title).toBe('Build orphan');
    expect(issues[0].state).toBe('building');
    expect(issues[0].issueType).toBe('orphaned_build');
    expect(issues[0].suggestedAction).toBeTruthy();
  });

  it('does not flag building item when worktree exists', () => {
    verso(tmpDir, 'init --defaults');
    writeFileSync(
      join(tmpDir, '.verso', 'board.yaml'),
      makeBoard([baseItem({ id: 1, title: 'Active build', state: 'building' })]),
    );
    // Create a matching worktree directory
    mkdirSync(join(tmpDir, '.worktrees', '1-active-build'), { recursive: true });

    const issues = recoverJson(tmpDir);
    expect(issues).toEqual([]);
  });

  // ── Stale review detection ─────────────────────────────────
  it('detects verifying item older than 24h', () => {
    verso(tmpDir, 'init --defaults');
    writeFileSync(
      join(tmpDir, '.verso', 'board.yaml'),
      makeBoard([baseItem({ id: 2, title: 'Stale review', state: 'verifying', updated_at: oldDate })]),
    );

    const issues = recoverJson(tmpDir);
    expect(issues).toHaveLength(1);
    expect(issues[0].itemId).toBe(2);
    expect(issues[0].title).toBe('Stale review');
    expect(issues[0].state).toBe('verifying');
    expect(issues[0].issueType).toBe('stale_review');
    expect(issues[0].suggestedAction).toBeTruthy();
  });

  it('does not flag recent verifying item', () => {
    verso(tmpDir, 'init --defaults');
    writeFileSync(
      join(tmpDir, '.verso', 'board.yaml'),
      makeBoard([baseItem({ id: 2, title: 'Fresh review', state: 'verifying', updated_at: now })]),
    );

    const issues = recoverJson(tmpDir);
    expect(issues).toEqual([]);
  });

  // ── Empty blocked reason detection ─────────────────────────
  it('detects blocked item with empty blocked_reason', () => {
    verso(tmpDir, 'init --defaults');
    writeFileSync(
      join(tmpDir, '.verso', 'board.yaml'),
      makeBoard([baseItem({ id: 3, title: 'Bad block', state: 'blocked', blocked_reason: '' })]),
    );

    const issues = recoverJson(tmpDir);
    expect(issues).toHaveLength(1);
    expect(issues[0].itemId).toBe(3);
    expect(issues[0].title).toBe('Bad block');
    expect(issues[0].state).toBe('blocked');
    expect(issues[0].issueType).toBe('empty_blocked_reason');
    expect(issues[0].suggestedAction).toBeTruthy();
  });

  it('does not flag blocked item with a reason', () => {
    verso(tmpDir, 'init --defaults');
    writeFileSync(
      join(tmpDir, '.verso', 'board.yaml'),
      makeBoard([baseItem({ id: 3, title: 'Good block', state: 'blocked', blocked_reason: 'Waiting on API' })]),
    );

    const issues = recoverJson(tmpDir);
    expect(issues).toEqual([]);
  });

  // ── Multiple issues ────────────────────────────────────────
  it('reports multiple issues', () => {
    verso(tmpDir, 'init --defaults');
    writeFileSync(
      join(tmpDir, '.verso', 'board.yaml'),
      makeBoard([
        baseItem({ id: 1, title: 'Orphan build', state: 'building' }),
        baseItem({ id: 2, title: 'Stale review', state: 'verifying', updated_at: oldDate }),
        baseItem({ id: 3, title: 'Bad block', state: 'blocked', blocked_reason: '' }),
      ]),
    );

    const issues = recoverJson(tmpDir);
    expect(issues).toHaveLength(3);

    const types = issues.map((i) => i.issueType).sort();
    expect(types).toEqual(['empty_blocked_reason', 'orphaned_build', 'stale_review']);
  });

  // ── --auto flag ────────────────────────────────────────────
  it('--auto moves orphaned building items back to queued', () => {
    verso(tmpDir, 'init --defaults');
    writeFileSync(
      join(tmpDir, '.verso', 'board.yaml'),
      makeBoard([baseItem({ id: 1, title: 'Orphan build', state: 'building' })]),
    );

    const issues = recoverJson(tmpDir, '--auto');
    expect(issues).toHaveLength(1);
    expect(issues[0].issueType).toBe('orphaned_build');

    // Verify board was updated
    const board = readBoard(tmpDir);
    expect(board.items[0].state).toBe('queued');
  });

  it('--auto moves stale verifying items back to queued', () => {
    verso(tmpDir, 'init --defaults');
    writeFileSync(
      join(tmpDir, '.verso', 'board.yaml'),
      makeBoard([baseItem({ id: 2, title: 'Stale review', state: 'verifying', updated_at: oldDate })]),
    );

    const issues = recoverJson(tmpDir, '--auto');
    expect(issues).toHaveLength(1);
    expect(issues[0].issueType).toBe('stale_review');

    // Verify board was updated
    const board = readBoard(tmpDir);
    expect(board.items[0].state).toBe('queued');
  });

  it('--auto does not modify blocked items (only reports)', () => {
    verso(tmpDir, 'init --defaults');
    writeFileSync(
      join(tmpDir, '.verso', 'board.yaml'),
      makeBoard([baseItem({ id: 3, title: 'Bad block', state: 'blocked', blocked_reason: '' })]),
    );

    const issues = recoverJson(tmpDir, '--auto');
    expect(issues).toHaveLength(1);
    expect(issues[0].issueType).toBe('empty_blocked_reason');

    // blocked items should NOT be auto-fixed (needs human decision)
    const board = readBoard(tmpDir);
    expect(board.items[0].state).toBe('blocked');
  });

  // ── Without --auto ─────────────────────────────────────────
  it('without --auto, does not modify board', () => {
    verso(tmpDir, 'init --defaults');
    writeFileSync(
      join(tmpDir, '.verso', 'board.yaml'),
      makeBoard([
        baseItem({ id: 1, title: 'Orphan build', state: 'building' }),
        baseItem({ id: 2, title: 'Stale review', state: 'verifying', updated_at: oldDate }),
      ]),
    );

    const boardBefore = readFileSync(join(tmpDir, '.verso', 'board.yaml'), 'utf-8');

    recoverJson(tmpDir);

    const boardAfter = readFileSync(join(tmpDir, '.verso', 'board.yaml'), 'utf-8');
    expect(boardAfter).toBe(boardBefore);
  });
});
