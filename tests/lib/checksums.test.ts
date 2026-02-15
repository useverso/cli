import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  hashContent,
  generateChecksums,
  readChecksums,
  writeChecksums,
} from '../../src/lib/checksums.js';
import type { ChecksumManifest } from '../../src/types/index.js';

let tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'verso-test-checksums-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe('hashContent', () => {
  it('produces a 64-char hex string (SHA-256)', () => {
    const hash = hashContent('hello world');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces consistent output for the same input', () => {
    const hash1 = hashContent('test content');
    const hash2 = hashContent('test content');
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different content', () => {
    const hash1 = hashContent('content A');
    const hash2 = hashContent('content B');
    expect(hash1).not.toBe(hash2);
  });

  it('handles empty string', () => {
    const hash = hashContent('');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('handles multiline content', () => {
    const hash = hashContent('line 1\nline 2\nline 3');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('writeChecksums + readChecksums', () => {
  it('round-trips a manifest correctly', async () => {
    const dir = await makeTempDir();
    await mkdir(join(dir, '.verso'), { recursive: true });

    const manifest: ChecksumManifest = {
      version: '1.2.3',
      files: {
        '.verso/config.yaml': 'abc123',
        '.verso/roadmap.yaml': 'def456',
      },
    };

    await writeChecksums(dir, manifest);
    const read = await readChecksums(dir);

    expect(read).toEqual(manifest);
  });

  it('returns null when checksums file does not exist', async () => {
    const dir = await makeTempDir();
    const read = await readChecksums(dir);
    expect(read).toBeNull();
  });
});

describe('generateChecksums', () => {
  it('generates checksums for existing files', async () => {
    const dir = await makeTempDir();
    await mkdir(join(dir, '.verso', 'agents'), { recursive: true });
    await writeFile(join(dir, '.verso', 'config.yaml'), 'scale: solo\n');
    await writeFile(join(dir, '.verso', 'roadmap.yaml'), 'vision: test\n');

    const manifest = await generateChecksums(dir);

    expect(manifest.files['.verso/config.yaml']).toBe(hashContent('scale: solo\n'));
    expect(manifest.files['.verso/roadmap.yaml']).toBe(hashContent('vision: test\n'));
  });

  it('skips files that do not exist', async () => {
    const dir = await makeTempDir();
    await mkdir(join(dir, '.verso', 'agents'), { recursive: true });
    // Only create one file
    await writeFile(join(dir, '.verso', 'config.yaml'), 'scale: solo\n');

    const manifest = await generateChecksums(dir);

    expect(manifest.files['.verso/config.yaml']).toBeDefined();
    // state-machine.yaml was not created, should not be in the manifest
    expect(manifest.files['.verso/state-machine.yaml']).toBeUndefined();
  });

  it('includes a version string', async () => {
    const dir = await makeTempDir();
    await mkdir(join(dir, '.verso'), { recursive: true });

    const manifest = await generateChecksums(dir);

    expect(typeof manifest.version).toBe('string');
    expect(manifest.version.length).toBeGreaterThan(0);
  });
});
