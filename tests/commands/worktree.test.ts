import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';

const CLI_ROOT = join(__dirname, '..', '..');

function verso(dir: string, args: string): string {
  return execSync(
    `cd "${dir}" && npx tsx "${join(CLI_ROOT, 'src', 'index.ts')}" ${args}`,
    { encoding: 'utf-8', stdio: 'pipe' },
  );
}

function versoFail(dir: string, args: string): string {
  try {
    execSync(
      `cd "${dir}" && npx tsx "${join(CLI_ROOT, 'src', 'index.ts')}" ${args}`,
      { encoding: 'utf-8', stdio: 'pipe' },
    );
    return '';
  } catch (err: unknown) {
    const e = err as { stderr?: string; stdout?: string };
    return (e.stderr ?? '') + (e.stdout ?? '');
  }
}

function git(dir: string, args: string): string {
  return execSync(`git ${args}`, { cwd: dir, encoding: 'utf-8', stdio: 'pipe' });
}

describe('verso worktree', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'verso-worktree-test-'));
    // Initialize a git repo with an initial commit
    git(tmpDir, 'init');
    git(tmpDir, 'config user.email "test@test.com"');
    git(tmpDir, 'config user.name "Test"');
    execSync('touch README.md', { cwd: tmpDir });
    git(tmpDir, 'add .');
    git(tmpDir, 'commit -m "initial commit"');
    // Initialize verso
    verso(tmpDir, 'init --defaults');
    // Add a feature board item
    verso(tmpDir, 'board add -t feature --title "Export CSV"');
    // Add a bug board item
    verso(tmpDir, 'board add -t bug --title "Fix login crash"');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // --- worktree add ---

  it('worktree add creates .worktrees/ directory', () => {
    verso(tmpDir, 'worktree add 1');
    expect(existsSync(join(tmpDir, '.worktrees'))).toBe(true);
  });

  it('worktree add creates correct branch name (feat/1-export-csv)', () => {
    verso(tmpDir, 'worktree add 1');
    const branches = git(tmpDir, 'branch --all');
    expect(branches).toContain('feat/1-export-csv');
  });

  it('worktree add creates correct branch for bug type (fix/2-fix-login-crash)', () => {
    verso(tmpDir, 'worktree add 2');
    const branches = git(tmpDir, 'branch --all');
    expect(branches).toContain('fix/2-fix-login-crash');
  });

  it('worktree add updates item branch field', () => {
    verso(tmpDir, 'worktree add 1');
    const output = verso(tmpDir, 'board show 1 --format json');
    const item = JSON.parse(output);
    expect(item.branch).toBe('feat/1-export-csv');
  });

  it('worktree add fails if item not found', () => {
    const output = versoFail(tmpDir, 'worktree add 99');
    expect(output).toContain('not found');
  });

  it('worktree add fails if worktree already exists', () => {
    verso(tmpDir, 'worktree add 1');
    const output = versoFail(tmpDir, 'worktree add 1');
    expect(output).toContain('already exists');
  });

  // --- worktree list ---

  it('worktree list --format json returns array', () => {
    verso(tmpDir, 'worktree add 1');
    const output = verso(tmpDir, 'worktree list --format json');
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it('worktree list shows created worktree', () => {
    verso(tmpDir, 'worktree add 1');
    const output = verso(tmpDir, 'worktree list --format json');
    const parsed = JSON.parse(output);
    expect(parsed.length).toBe(1);
    expect(parsed[0].id).toBe(1);
    expect(parsed[0].branch).toBe('feat/1-export-csv');
    expect(parsed[0].directory).toContain('1-export-csv');
  });

  it('worktree list --format json returns empty array when no worktrees', () => {
    const output = verso(tmpDir, 'worktree list --format json');
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(0);
  });

  // --- worktree remove ---

  it('worktree remove removes the worktree directory', () => {
    verso(tmpDir, 'worktree add 1');
    expect(existsSync(join(tmpDir, '.worktrees', '1-export-csv'))).toBe(true);
    verso(tmpDir, 'worktree remove 1');
    expect(existsSync(join(tmpDir, '.worktrees', '1-export-csv'))).toBe(false);
  });

  it('worktree remove clears item branch field', () => {
    verso(tmpDir, 'worktree add 1');
    verso(tmpDir, 'worktree remove 1');
    const output = verso(tmpDir, 'board show 1 --format json');
    const item = JSON.parse(output);
    expect(item.branch).toBe('');
  });

  it('worktree remove fails if worktree not found', () => {
    const output = versoFail(tmpDir, 'worktree remove 99');
    expect(output).toContain('not found');
  });
});
