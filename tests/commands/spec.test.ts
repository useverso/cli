import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { slugify, createSpec } from '../../src/commands/spec.js';
import * as board from '../../src/core/board.js';
import type { BoardFile } from '../../src/core/types.js';

const CLI = join(__dirname, '..', '..', 'src', 'index.ts');

function verso(dir: string, args: string): string {
  return execSync(`cd "${dir}" && npx tsx "${CLI}" ${args}`, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

// ── Unit tests ─────────────────────────────────────────────

describe('slugify', () => {
  it('converts title to lowercase hyphenated slug', () => {
    expect(slugify('Export Data as CSV')).toBe('export-data-as-csv');
  });

  it('strips non-alphanumeric characters', () => {
    expect(slugify('Hello, World! (v2)')).toBe('hello-world-v2');
  });

  it('collapses multiple hyphens', () => {
    expect(slugify('foo  --  bar')).toBe('foo-bar');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugify('  --Hello-- ')).toBe('hello');
  });

  it('handles empty string', () => {
    expect(slugify('')).toBe('');
  });
});

describe('createSpec', () => {
  let tmpDir: string;
  let versoDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'verso-spec-test-'));
    versoDir = join(tmpDir, '.verso');
    mkdirSync(versoDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeBoardWithItem(
    title: string,
    overrides: Partial<{ spec_path: string }> = {},
  ): BoardFile {
    const b: BoardFile = { schema_version: 2, items: [] };
    board.addItem(b, 'feature', title, 2);
    if (overrides.spec_path !== undefined) {
      board.updateItem(b, 1, { spec_path: overrides.spec_path });
    }
    board.saveBoard(versoDir, b);
    return b;
  }

  it('creates spec file at correct path', () => {
    makeBoardWithItem('Export Data as CSV');
    const result = createSpec(versoDir, 1, false);
    const expectedPath = '.verso/specs/1-export-data-as-csv.md';
    expect(result.spec_path).toBe(expectedPath);
    expect(existsSync(join(tmpDir, expectedPath))).toBe(true);
  });

  it('spec file contains item title', () => {
    makeBoardWithItem('Export Data as CSV');
    const result = createSpec(versoDir, 1, false);
    const content = readFileSync(join(tmpDir, result.spec_path), 'utf-8');
    expect(content).toContain('# Spec: Export Data as CSV');
  });

  it('updates item spec_path', () => {
    makeBoardWithItem('Export Data as CSV');
    createSpec(versoDir, 1, false);
    const updated = board.loadBoard(versoDir);
    const item = board.getItem(updated, 1);
    expect(item!.spec_path).toBe('.verso/specs/1-export-data-as-csv.md');
  });

  it('fails when item not found', () => {
    makeBoardWithItem('Some item');
    expect(() => createSpec(versoDir, 99, false)).toThrow(/not found/);
  });

  it('fails when spec already exists (spec_path set)', () => {
    makeBoardWithItem('Export Data as CSV', { spec_path: '.verso/specs/1-old.md' });
    expect(() => createSpec(versoDir, 1, false)).toThrow(/already has a spec/);
  });

  it('works with --force when spec already exists', () => {
    makeBoardWithItem('Export Data as CSV', { spec_path: '.verso/specs/1-old.md' });
    const result = createSpec(versoDir, 1, true);
    expect(result.spec_path).toBe('.verso/specs/1-export-data-as-csv.md');
    expect(existsSync(join(tmpDir, result.spec_path))).toBe(true);
  });

  it('creates specs directory if it does not exist', () => {
    makeBoardWithItem('New Feature');
    const specsDir = join(versoDir, 'specs');
    expect(existsSync(specsDir)).toBe(false);
    createSpec(versoDir, 1, false);
    expect(existsSync(specsDir)).toBe(true);
  });
});

// ── Integration tests ──────────────────────────────────────

// Skipped: requires registerSpecCommand in src/index.ts (not yet registered)
describe.skip('verso spec create (integration)', { timeout: 30_000 }, () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'verso-spec-int-'));
    verso(tmpDir, 'init --defaults');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates spec via CLI and returns JSON with spec_path', () => {
    verso(tmpDir, 'board add -t feature --title "User Authentication"');
    const out = verso(tmpDir, 'spec create 1 --format json');
    const result = JSON.parse(out);
    expect(result.spec_path).toBe('.verso/specs/1-user-authentication.md');
    expect(result.id).toBe(1);

    // Verify file was created
    const specContent = readFileSync(join(tmpDir, result.spec_path), 'utf-8');
    expect(specContent).toContain('# Spec: User Authentication');

    // Verify board was updated
    const boardOut = verso(tmpDir, 'board show 1 --format json');
    const item = JSON.parse(boardOut);
    expect(item.spec_path).toBe('.verso/specs/1-user-authentication.md');
  });
});
