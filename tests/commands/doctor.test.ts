import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { REQUIRED_FILES, VERSO_DIR } from '../../src/constants.js';

let tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'verso-test-doctor-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

/**
 * Set up a valid .verso/ directory in the given root by copying the actual templates.
 */
async function setupValidVerso(projectRoot: string): Promise<void> {
  const templatesDir = join(process.cwd(), 'templates');

  // If we're running from the CLI dir, templates should be available
  if (existsSync(templatesDir)) {
    await cp(join(templatesDir, '.verso'), join(projectRoot, '.verso'), { recursive: true });
  } else {
    // Fallback: create minimal valid structure
    await mkdir(join(projectRoot, '.verso', 'agents'), { recursive: true });
    await writeFile(
      join(projectRoot, '.verso', 'config.yaml'),
      [
        'scale: solo',
        'autonomy:',
        '  feature: 2',
        '  enhancement: 2',
        '  bug: 3',
        '  hotfix: 3',
        '  refactor: 2',
        '  chore: 4',
        'wip:',
        '  building: 2',
        '  pr_ready: 5',
        'board:',
        '  provider: github',
        'debt:',
        '  target_ratio: 0.2',
        '  audit_trigger: milestone',
        'costs:',
        '  enabled: true',
        '',
      ].join('\n'),
    );
    await writeFile(join(projectRoot, '.verso', 'roadmap.yaml'), 'vision: test\n');
    await writeFile(join(projectRoot, '.verso', 'state-machine.yaml'), 'states: []\n');
    await writeFile(join(projectRoot, '.verso', 'releases.yaml'), 'strategy: semver\n');
    await writeFile(join(projectRoot, '.verso', 'agents', 'pilot.md'), '# Pilot\n');
    await writeFile(join(projectRoot, '.verso', 'agents', 'builder.md'), '# Builder\n');
    await writeFile(join(projectRoot, '.verso', 'agents', 'reviewer.md'), '# Reviewer\n');
  }
}

describe('doctor command checks', () => {
  it('can be imported without errors', async () => {
    const mod = await import('../../src/commands/doctor.js');
    expect(mod.doctorCommand).toBeDefined();
    expect(typeof mod.doctorCommand).toBe('function');
  });

  describe('check: .verso/ directory exists', () => {
    it('detects when .verso/ exists', async () => {
      const dir = await makeTempDir();
      await setupValidVerso(dir);

      expect(existsSync(join(dir, VERSO_DIR))).toBe(true);
    });

    it('detects when .verso/ is missing', async () => {
      const dir = await makeTempDir();
      expect(existsSync(join(dir, VERSO_DIR))).toBe(false);
    });
  });

  describe('check: required files present', () => {
    it('all required files present after valid setup', async () => {
      const dir = await makeTempDir();
      await setupValidVerso(dir);

      const missingFiles: string[] = [];
      for (const file of REQUIRED_FILES) {
        if (!existsSync(join(dir, file))) {
          missingFiles.push(file);
        }
      }
      expect(missingFiles).toEqual([]);
    });

    it('detects missing required files', async () => {
      const dir = await makeTempDir();
      await mkdir(join(dir, '.verso', 'agents'), { recursive: true });
      // Only create config.yaml, nothing else
      await writeFile(join(dir, '.verso', 'config.yaml'), 'scale: solo\n');

      const missingFiles: string[] = [];
      for (const file of REQUIRED_FILES) {
        if (!existsSync(join(dir, file))) {
          missingFiles.push(file);
        }
      }
      expect(missingFiles.length).toBeGreaterThan(0);
      expect(missingFiles).toContain('.verso/roadmap.yaml');
    });
  });

  describe('check: YAML parsing', () => {
    it('valid YAML files parse correctly', async () => {
      const dir = await makeTempDir();
      await setupValidVerso(dir);

      const configPath = join(dir, '.verso', 'config.yaml');
      const raw = await readFile(configPath, 'utf-8');
      expect(() => parse(raw)).not.toThrow();
    });

    it('detects invalid YAML', async () => {
      const dir = await makeTempDir();
      await setupValidVerso(dir);

      // Corrupt the config.yaml with invalid YAML
      await writeFile(join(dir, '.verso', 'config.yaml'), ':\ninvalid: {[yaml\n');

      const configPath = join(dir, '.verso', 'config.yaml');
      const raw = await readFile(configPath, 'utf-8');
      expect(() => parse(raw)).toThrow();
    });
  });

  describe('check: config completeness', () => {
    it('complete config passes all checks', async () => {
      const dir = await makeTempDir();
      await setupValidVerso(dir);

      const raw = await readFile(join(dir, '.verso', 'config.yaml'), 'utf-8');
      const config = parse(raw) as Record<string, unknown>;

      expect(config.scale).toBeDefined();
      expect(config.autonomy).toBeDefined();
      expect(typeof config.autonomy).toBe('object');
      expect(config.wip).toBeDefined();
      expect(config.board).toBeDefined();
    });

    it('detects missing scale', async () => {
      const dir = await makeTempDir();
      await mkdir(join(dir, '.verso'), { recursive: true });
      await writeFile(
        join(dir, '.verso', 'config.yaml'),
        'autonomy:\n  feature: 2\nwip:\n  building: 2\n  pr_ready: 5\nboard:\n  provider: github\n',
      );

      const raw = await readFile(join(dir, '.verso', 'config.yaml'), 'utf-8');
      const config = parse(raw) as Record<string, unknown>;

      expect(config.scale).toBeUndefined();
    });

    it('detects missing autonomy section', async () => {
      const dir = await makeTempDir();
      await mkdir(join(dir, '.verso'), { recursive: true });
      await writeFile(
        join(dir, '.verso', 'config.yaml'),
        'scale: solo\nwip:\n  building: 2\n  pr_ready: 5\nboard:\n  provider: github\n',
      );

      const raw = await readFile(join(dir, '.verso', 'config.yaml'), 'utf-8');
      const config = parse(raw) as Record<string, unknown>;

      expect(config.autonomy).toBeUndefined();
    });

    it('detects missing wip fields', async () => {
      const dir = await makeTempDir();
      await mkdir(join(dir, '.verso'), { recursive: true });
      await writeFile(
        join(dir, '.verso', 'config.yaml'),
        'scale: solo\nautonomy:\n  feature: 2\nboard:\n  provider: github\n',
      );

      const raw = await readFile(join(dir, '.verso', 'config.yaml'), 'utf-8');
      const config = parse(raw) as Record<string, unknown>;

      expect(config.wip).toBeUndefined();
    });

    it('detects missing board provider', async () => {
      const dir = await makeTempDir();
      await mkdir(join(dir, '.verso'), { recursive: true });
      await writeFile(
        join(dir, '.verso', 'config.yaml'),
        'scale: solo\nautonomy:\n  feature: 2\nwip:\n  building: 2\n  pr_ready: 5\n',
      );

      const raw = await readFile(join(dir, '.verso', 'config.yaml'), 'utf-8');
      const config = parse(raw) as Record<string, unknown>;

      expect(config.board).toBeUndefined();
    });
  });
});
