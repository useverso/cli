import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hashContent, writeChecksums } from '../../src/lib/checksums.js';
import { readYamlDocument, writeYamlDocument } from '../../src/lib/config.js';
import { mergeYamlDocuments } from '../../src/lib/yaml-merge.js';
import type { ChecksumManifest } from '../../src/types/index.js';

let tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'verso-test-upgrade-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe('upgrade command', () => {
  it('can be imported without errors', async () => {
    const mod = await import('../../src/commands/upgrade.js');
    expect(mod.upgradeCommand).toBeDefined();
    expect(typeof mod.upgradeCommand).toBe('function');
  });

  describe('upgrade building blocks', () => {
    it('detects file that has changed from original via checksum comparison', async () => {
      const dir = await makeTempDir();
      await mkdir(join(dir, '.verso'), { recursive: true });

      const originalContent = 'scale: solo\n';
      const originalHash = hashContent(originalContent);

      // Write the file with modified content
      const modifiedContent = 'scale: enterprise\n';
      await writeFile(join(dir, '.verso', 'config.yaml'), modifiedContent);

      const currentHash = hashContent(modifiedContent);

      // The hashes should differ, indicating user modification
      expect(currentHash).not.toBe(originalHash);
    });

    it('identifies unmodified file via matching checksum', async () => {
      const dir = await makeTempDir();
      await mkdir(join(dir, '.verso'), { recursive: true });

      const content = 'scale: solo\n';
      const hash = hashContent(content);

      await writeFile(join(dir, '.verso', 'config.yaml'), content);
      const currentContent = await readFile(join(dir, '.verso', 'config.yaml'), 'utf-8');
      const currentHash = hashContent(currentContent);

      expect(currentHash).toBe(hash);
    });

    it('checksums manifest tracks file hashes correctly', async () => {
      const dir = await makeTempDir();
      await mkdir(join(dir, '.verso'), { recursive: true });

      const manifest: ChecksumManifest = {
        version: '0.0.1',
        files: {
          '.verso/config.yaml': hashContent('original config\n'),
          '.verso/roadmap.yaml': hashContent('original roadmap\n'),
        },
      };

      await writeChecksums(dir, manifest);

      // Write different content to config
      await writeFile(join(dir, '.verso', 'config.yaml'), 'modified config\n');

      const localHash = hashContent(await readFile(join(dir, '.verso', 'config.yaml'), 'utf-8'));
      const originalHash = manifest.files['.verso/config.yaml'];

      // User modified config, so hashes differ
      expect(localHash).not.toBe(originalHash);
    });

    it('yaml merge adds new template keys during upgrade', async () => {
      const dir = await makeTempDir();

      // Simulate user's config (missing a new key that template added)
      const userYaml = 'scale: enterprise\nautonomy:\n  feature: 3\nwip:\n  building: 8\n  pr_ready: 20\nboard:\n  provider: linear\n';
      const templateYaml = 'scale: solo\nautonomy:\n  feature: 2\nwip:\n  building: 2\n  pr_ready: 5\nboard:\n  provider: github\nnew_section:\n  enabled: true\n';

      const userPath = join(dir, 'user.yaml');
      const templatePath = join(dir, 'template.yaml');
      await writeFile(userPath, userYaml);
      await writeFile(templatePath, templateYaml);

      const userDoc = await readYamlDocument(userPath);
      const templateDoc = await readYamlDocument(templatePath);
      mergeYamlDocuments(userDoc, templateDoc);
      await writeYamlDocument(userPath, userDoc);

      const result = await readFile(userPath, 'utf-8');

      // User values preserved
      expect(result).toContain('scale: enterprise');
      expect(result).toContain('provider: linear');

      // New key added from template
      expect(result).toContain('new_section');
      expect(result).toContain('enabled: true');
    });

    it('detects when a template file is newer than the installed version', async () => {
      const dir = await makeTempDir();
      await mkdir(join(dir, '.verso', 'agents'), { recursive: true });

      const originalRoadmap = 'vision: "Build something great"\nhorizons:\n  now:\n    milestone: mvp\n';
      const updatedRoadmap = 'vision: "Build something great"\nhorizons:\n  now:\n    milestone: mvp\n  next:\n    milestone: v2\n';

      // Install original version
      await writeFile(join(dir, '.verso', 'roadmap.yaml'), originalRoadmap);
      const originalHash = hashContent(originalRoadmap);

      // "New template" has updated content
      const templateHash = hashContent(updatedRoadmap);

      // Local file hash matches original — user has not modified it
      const localHash = hashContent(await readFile(join(dir, '.verso', 'roadmap.yaml'), 'utf-8'));
      expect(localHash).toBe(originalHash);

      // Template has changed since last install
      expect(templateHash).not.toBe(originalHash);

      // Since user hasn't modified (localHash === originalHash), safe to auto-update
      expect(localHash).toBe(originalHash);
    });

    it('identifies user-modified file that also has a template update (conflict scenario)', async () => {
      const dir = await makeTempDir();
      await mkdir(join(dir, '.verso'), { recursive: true });

      const originalContent = 'states:\n  - captured\n  - refined\n';
      const userModified = 'states:\n  - captured\n  - refined\n  - custom_state\n';
      const templateUpdated = 'states:\n  - captured\n  - refined\n  - queued\n';

      const originalHash = hashContent(originalContent);

      // User has modified the file
      await writeFile(join(dir, '.verso', 'state-machine.yaml'), userModified);
      const localHash = hashContent(await readFile(join(dir, '.verso', 'state-machine.yaml'), 'utf-8'));
      const templateHash = hashContent(templateUpdated);

      // Local differs from original (user modified)
      expect(localHash).not.toBe(originalHash);
      // Template also differs from original (template updated)
      expect(templateHash).not.toBe(originalHash);
      // Local differs from template (conflict)
      expect(localHash).not.toBe(templateHash);
    });
  });
});
