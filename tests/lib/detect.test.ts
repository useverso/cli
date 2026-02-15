import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectProjectName, isGitRepo } from '../../src/lib/detect.js';

let tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'verso-test-detect-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe('detectProjectName', () => {
  it('detects name from package.json', async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'my-app' }));

    const name = await detectProjectName(dir);
    expect(name).toBe('my-app');
  });

  it('strips npm scope from package.json name', async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: '@org/my-lib' }));

    const name = await detectProjectName(dir);
    expect(name).toBe('my-lib');
  });

  it('detects name from Cargo.toml', async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, 'Cargo.toml'), '[package]\nname = "rust-project"\nversion = "0.1.0"\n');

    const name = await detectProjectName(dir);
    expect(name).toBe('rust-project');
  });

  it('detects name from go.mod (last path segment)', async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, 'go.mod'), 'module github.com/org/mymod\n\ngo 1.21\n');

    const name = await detectProjectName(dir);
    expect(name).toBe('mymod');
  });

  it('detects name from pyproject.toml', async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "python-pkg"\nversion = "1.0"\n');

    const name = await detectProjectName(dir);
    expect(name).toBe('python-pkg');
  });

  it('falls back to directory name when no config files exist', async () => {
    const dir = await makeTempDir();
    const name = await detectProjectName(dir);
    // The temp dir name starts with "verso-test-detect-", basename will be that
    expect(name).toBe(dir.split('/').pop());
  });

  it('falls back to directory name with invalid package.json', async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, 'package.json'), 'not valid json');

    const name = await detectProjectName(dir);
    expect(name).toBe(dir.split('/').pop());
  });

  it('prefers package.json over Cargo.toml', async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'from-pkg' }));
    await writeFile(join(dir, 'Cargo.toml'), '[package]\nname = "from-cargo"\n');

    const name = await detectProjectName(dir);
    expect(name).toBe('from-pkg');
  });
});

describe('isGitRepo', () => {
  it('returns true when .git/HEAD exists', async () => {
    const dir = await makeTempDir();
    await mkdir(join(dir, '.git'), { recursive: true });
    await writeFile(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');

    const result = await isGitRepo(dir);
    expect(result).toBe(true);
  });

  it('returns false when .git does not exist', async () => {
    const dir = await makeTempDir();

    const result = await isGitRepo(dir);
    expect(result).toBe(false);
  });

  it('returns false when .git exists but HEAD is missing', async () => {
    const dir = await makeTempDir();
    await mkdir(join(dir, '.git'), { recursive: true });

    const result = await isGitRepo(dir);
    expect(result).toBe(false);
  });
});
