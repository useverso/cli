import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  unlinkSync,
  readFileSync,
} from 'node:fs';
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

/** Parse JSON doctor output */
function doctorJson(dir: string): {
  checks: Array<{ name: string; severity: string; message: string }>;
  has_failures: boolean;
  has_warnings: boolean;
} {
  const out = verso(dir, 'doctor --format json');
  return JSON.parse(out);
}

describe('verso doctor', { timeout: 30_000 }, () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'verso-doctor-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── 1. Passes on valid project ──────────────────────────────
  describe('valid project', () => {
    it('passes all checks on a freshly initialized project', () => {
      verso(tmpDir, 'init --defaults');
      const result = doctorJson(tmpDir);

      expect(result.has_failures).toBe(false);
      expect(result.checks.length).toBeGreaterThan(0);

      const fails = result.checks.filter((c) => c.severity === 'fail');
      expect(fails).toHaveLength(0);
    });

    it('reports all critical file checks as pass', () => {
      verso(tmpDir, 'init --defaults');
      const result = doctorJson(tmpDir);

      const dirCheck = result.checks.find((c) => c.name === 'verso_dir');
      expect(dirCheck).toBeDefined();
      expect(dirCheck!.severity).toBe('pass');

      const configCheck = result.checks.find((c) => c.name === 'config_yaml');
      expect(configCheck).toBeDefined();
      expect(configCheck!.severity).toBe('pass');

      const boardCheck = result.checks.find((c) => c.name === 'board_yaml');
      expect(boardCheck).toBeDefined();
      expect(boardCheck!.severity).toBe('pass');
    });

    it('reports schema_version checks as pass', () => {
      verso(tmpDir, 'init --defaults');
      const result = doctorJson(tmpDir);

      const configSchema = result.checks.find((c) => c.name === 'config_yaml_schema');
      expect(configSchema).toBeDefined();
      expect(configSchema!.severity).toBe('pass');
      expect(configSchema!.message).toContain('schema_version');

      const boardSchema = result.checks.find((c) => c.name === 'board_yaml_schema');
      expect(boardSchema).toBeDefined();
      expect(boardSchema!.severity).toBe('pass');
      expect(boardSchema!.message).toContain('schema_version');
    });

    it('reports board items check as pass with empty board', () => {
      verso(tmpDir, 'init --defaults');
      const result = doctorJson(tmpDir);

      const boardItems = result.checks.find((c) => c.name === 'board_items_valid');
      expect(boardItems).toBeDefined();
      expect(boardItems!.severity).toBe('pass');
    });

    it('reports WIP limits check as pass on empty board', () => {
      verso(tmpDir, 'init --defaults');
      const result = doctorJson(tmpDir);

      const wipCheck = result.checks.find((c) => c.name === 'wip_limits');
      expect(wipCheck).toBeDefined();
      expect(wipCheck!.severity).toBe('pass');
    });

    it('reports plain format correctly for valid project', () => {
      verso(tmpDir, 'init --defaults');
      const out = verso(tmpDir, 'doctor --format plain');

      expect(out).toContain('verso_dir: pass');
      expect(out).toContain('config_yaml: pass');
      expect(out).toContain('board_yaml: pass');
      expect(out).toContain('board_items_valid: pass');
      expect(out).toContain('wip_limits: pass');
    });
  });

  // ── 2. Fails on missing .verso/ ─────────────────────────────
  describe('missing .verso directory', () => {
    it('fails when .verso/ directory does not exist', () => {
      const out = versoFail(tmpDir, 'doctor --format json');
      const result = JSON.parse(out);

      expect(result.has_failures).toBe(true);

      const dirCheck = result.checks.find(
        (c: { name: string }) => c.name === 'verso_dir',
      );
      expect(dirCheck).toBeDefined();
      expect(dirCheck.severity).toBe('fail');
      expect(dirCheck.message).toContain('.verso/ directory not found');
    });

    it('only has one check when .verso/ is missing (skips file checks)', () => {
      const out = versoFail(tmpDir, 'doctor --format json');
      const result = JSON.parse(out);

      // When .verso/ is missing, only the dir check should run
      expect(result.checks).toHaveLength(1);
      expect(result.checks[0].name).toBe('verso_dir');
    });

    it('reports failure in plain format', () => {
      const out = versoFail(tmpDir, 'doctor --format plain');
      expect(out).toContain('verso_dir: fail');
    });
  });

  // ── 3. Fails on missing required files ──────────────────────
  describe('missing required files', () => {
    it('fails when config.yaml is missing', () => {
      verso(tmpDir, 'init --defaults');
      // Remove config.yaml
      unlinkSync(join(tmpDir, '.verso', 'config.yaml'));

      const out = versoFail(tmpDir, 'doctor --format json');
      const result = JSON.parse(out);

      expect(result.has_failures).toBe(true);

      const configCheck = result.checks.find(
        (c: { name: string }) => c.name === 'config_yaml',
      );
      expect(configCheck).toBeDefined();
      expect(configCheck.severity).toBe('fail');
      expect(configCheck.message).toContain('config.yaml not found');
    });

    it('fails when board.yaml is missing', () => {
      verso(tmpDir, 'init --defaults');
      // Remove board.yaml
      unlinkSync(join(tmpDir, '.verso', 'board.yaml'));

      const out = versoFail(tmpDir, 'doctor --format json');
      const result = JSON.parse(out);

      expect(result.has_failures).toBe(true);

      const boardCheck = result.checks.find(
        (c: { name: string }) => c.name === 'board_yaml',
      );
      expect(boardCheck).toBeDefined();
      expect(boardCheck.severity).toBe('fail');
      expect(boardCheck.message).toContain('board.yaml not found');
    });

    it('warns (not fails) when optional files are missing', () => {
      verso(tmpDir, 'init --defaults');
      // Remove optional files
      unlinkSync(join(tmpDir, '.verso', 'roadmap.yaml'));
      unlinkSync(join(tmpDir, '.verso', 'releases.yaml'));
      unlinkSync(join(tmpDir, '.verso', 'state-machine.yaml'));

      const result = doctorJson(tmpDir);

      // Optional files should be warnings, not failures
      const roadmapCheck = result.checks.find((c) => c.name === 'roadmap_yaml');
      expect(roadmapCheck).toBeDefined();
      expect(roadmapCheck!.severity).toBe('warn');

      const releasesCheck = result.checks.find((c) => c.name === 'releases_yaml');
      expect(releasesCheck).toBeDefined();
      expect(releasesCheck!.severity).toBe('warn');

      const smCheck = result.checks.find((c) => c.name === 'state-machine_yaml');
      expect(smCheck).toBeDefined();
      expect(smCheck!.severity).toBe('warn');

      // Should NOT have failures for these
      expect(result.has_failures).toBe(false);
      expect(result.has_warnings).toBe(true);
    });

    it('reports which specific files are missing', () => {
      verso(tmpDir, 'init --defaults');
      unlinkSync(join(tmpDir, '.verso', 'config.yaml'));
      unlinkSync(join(tmpDir, '.verso', 'board.yaml'));

      const out = versoFail(tmpDir, 'doctor --format json');
      const result = JSON.parse(out);

      const failedChecks = result.checks.filter(
        (c: { severity: string }) => c.severity === 'fail',
      );
      const failNames = failedChecks.map((c: { name: string }) => c.name);

      expect(failNames).toContain('config_yaml');
      expect(failNames).toContain('board_yaml');
    });
  });

  // ── 4. Fails on invalid YAML ────────────────────────────────
  describe('invalid YAML', () => {
    it('fails when config.yaml has malformed YAML', () => {
      verso(tmpDir, 'init --defaults');
      // Write invalid YAML
      writeFileSync(
        join(tmpDir, '.verso', 'config.yaml'),
        '{{{{invalid yaml: [unclosed',
        'utf-8',
      );

      const out = versoFail(tmpDir, 'doctor --format json');
      const result = JSON.parse(out);

      expect(result.has_failures).toBe(true);

      const configValid = result.checks.find(
        (c: { name: string }) => c.name === 'config_yaml_valid',
      );
      expect(configValid).toBeDefined();
      expect(configValid.severity).toBe('fail');
      expect(configValid.message).toContain('invalid YAML');
    });

    it('fails when board.yaml has malformed YAML', () => {
      verso(tmpDir, 'init --defaults');
      // Write invalid YAML
      writeFileSync(
        join(tmpDir, '.verso', 'board.yaml'),
        'not: valid: yaml: {{{{',
        'utf-8',
      );

      const out = versoFail(tmpDir, 'doctor --format json');
      const result = JSON.parse(out);

      expect(result.has_failures).toBe(true);

      const boardValid = result.checks.find(
        (c: { name: string }) => c.name === 'board_yaml_valid',
      );
      expect(boardValid).toBeDefined();
      expect(boardValid.severity).toBe('fail');
      expect(boardValid.message).toContain('invalid YAML');
    });
  });

  // ── 5. Fails on missing schema_version ──────────────────────
  describe('missing schema_version', () => {
    it('warns when config.yaml has no schema_version field', () => {
      verso(tmpDir, 'init --defaults');
      // Write valid YAML without schema_version
      writeFileSync(
        join(tmpDir, '.verso', 'config.yaml'),
        yaml.dump({ scale: 'solo', wip: { building: 2, pr_ready: 5 } }),
        'utf-8',
      );

      const result = doctorJson(tmpDir);

      const configSchema = result.checks.find((c) => c.name === 'config_yaml_schema');
      expect(configSchema).toBeDefined();
      expect(configSchema!.severity).toBe('warn');
      expect(configSchema!.message).toContain('missing schema_version');
    });

    it('warns when board.yaml has no schema_version field', () => {
      verso(tmpDir, 'init --defaults');
      // Write valid YAML without schema_version
      writeFileSync(
        join(tmpDir, '.verso', 'board.yaml'),
        yaml.dump({ items: [] }),
        'utf-8',
      );

      const result = doctorJson(tmpDir);

      const boardSchema = result.checks.find((c) => c.name === 'board_yaml_schema');
      expect(boardSchema).toBeDefined();
      expect(boardSchema!.severity).toBe('warn');
      expect(boardSchema!.message).toContain('missing schema_version');
    });
  });

  // ── 6. Validates board.yaml structure ───────────────────────
  describe('board structure validation', () => {
    it('passes with valid board items', () => {
      verso(tmpDir, 'init --defaults');
      // Add some items through the CLI
      verso(tmpDir, 'board add -t feature --title "Valid item"');
      verso(tmpDir, 'board add -t bug --title "Another item"');

      const result = doctorJson(tmpDir);

      const boardItems = result.checks.find((c) => c.name === 'board_items_valid');
      expect(boardItems).toBeDefined();
      expect(boardItems!.severity).toBe('pass');
      expect(boardItems!.message).toContain('2 board items');
    });

    it('passes with empty items array', () => {
      verso(tmpDir, 'init --defaults');

      const result = doctorJson(tmpDir);

      const boardItems = result.checks.find((c) => c.name === 'board_items_valid');
      expect(boardItems).toBeDefined();
      expect(boardItems!.severity).toBe('pass');
      expect(boardItems!.message).toContain('0 board items');
    });

    it('fails when board.yaml is not parseable for item validation', () => {
      verso(tmpDir, 'init --defaults');
      // Write something that will cause loadBoard to fail
      writeFileSync(
        join(tmpDir, '.verso', 'board.yaml'),
        '{{{{invalid',
        'utf-8',
      );

      const out = versoFail(tmpDir, 'doctor --format json');
      const result = JSON.parse(out);

      const boardItems = result.checks.find(
        (c: { name: string }) => c.name === 'board_items_valid',
      );
      expect(boardItems).toBeDefined();
      expect(boardItems.severity).toBe('fail');
      expect(boardItems.message).toContain('cannot load board');
    });
  });

  // ── 7. Reports WIP violations ──────────────────────────────
  describe('WIP violations', () => {
    it('warns when building WIP limit is exceeded', () => {
      verso(tmpDir, 'init --defaults');

      // Default WIP building limit is 2 for solo scale
      // Add 3 items and move them all to building
      verso(tmpDir, 'board add -t feature --title "Item 1"');
      verso(tmpDir, 'board add -t feature --title "Item 2"');
      verso(tmpDir, 'board add -t feature --title "Item 3"');

      // Move all to building (captured -> refined -> queued -> building)
      for (const id of [1, 2, 3]) {
        verso(tmpDir, `board move ${id} --to refined --trigger spec_approved`);
        verso(tmpDir, `board move ${id} --to queued --trigger priority_set`);
      }

      // Start building first 2 (within WIP limit for the move command)
      verso(tmpDir, 'build start 1');
      verso(tmpDir, 'build start 2');

      // Force the 3rd item to building by editing board.yaml directly
      const boardPath = join(tmpDir, '.verso', 'board.yaml');
      const boardContent = readFileSync(boardPath, 'utf-8');
      const board = yaml.load(boardContent) as Record<string, unknown>;
      const items = board.items as Array<Record<string, unknown>>;
      items[2].state = 'building';
      writeFileSync(boardPath, yaml.dump(board), 'utf-8');

      const result = doctorJson(tmpDir);

      const wipCheck = result.checks.find((c) => c.name === 'wip_limits');
      expect(wipCheck).toBeDefined();
      expect(wipCheck!.severity).toBe('warn');
      expect(wipCheck!.message).toContain('WIP exceeded');
      expect(wipCheck!.message).toContain('3');
      expect(wipCheck!.message).toContain('limit: 2');
    });

    it('passes when building count is within WIP limit', () => {
      verso(tmpDir, 'init --defaults');

      // Add 2 items and move to building (within solo WIP limit of 2)
      verso(tmpDir, 'board add -t feature --title "Item 1"');
      verso(tmpDir, 'board add -t feature --title "Item 2"');

      for (const id of [1, 2]) {
        verso(tmpDir, `board move ${id} --to refined --trigger spec_approved`);
        verso(tmpDir, `board move ${id} --to queued --trigger priority_set`);
      }

      verso(tmpDir, 'build start 1');
      verso(tmpDir, 'build start 2');

      const result = doctorJson(tmpDir);

      const wipCheck = result.checks.find((c) => c.name === 'wip_limits');
      expect(wipCheck).toBeDefined();
      expect(wipCheck!.severity).toBe('pass');
      expect(wipCheck!.message).toContain('WIP within limits');
    });

    it('passes when no items are in building state', () => {
      verso(tmpDir, 'init --defaults');
      verso(tmpDir, 'board add -t feature --title "Captured item"');

      const result = doctorJson(tmpDir);

      const wipCheck = result.checks.find((c) => c.name === 'wip_limits');
      expect(wipCheck).toBeDefined();
      expect(wipCheck!.severity).toBe('pass');
    });
  });

  // ── Agent file checks ──────────────────────────────────────
  describe('agent files', () => {
    it('checks pilot.md exists', () => {
      verso(tmpDir, 'init --defaults');
      const result = doctorJson(tmpDir);

      const pilotCheck = result.checks.find((c) => c.name === 'agents_pilot_md');
      expect(pilotCheck).toBeDefined();
      expect(pilotCheck!.severity).toBe('pass');
    });

    it('warns when pilot.md is missing', () => {
      verso(tmpDir, 'init --defaults');
      unlinkSync(join(tmpDir, '.verso', 'agents', 'pilot.md'));

      const result = doctorJson(tmpDir);

      const pilotCheck = result.checks.find((c) => c.name === 'agents_pilot_md');
      expect(pilotCheck).toBeDefined();
      expect(pilotCheck!.severity).toBe('warn');
    });
  });

  // ── Templates directory check ───────────────────────────────
  describe('templates directory', () => {
    it('checks templates/ directory exists', () => {
      verso(tmpDir, 'init --defaults');
      const result = doctorJson(tmpDir);

      const templatesCheck = result.checks.find((c) => c.name === 'templates_dir');
      expect(templatesCheck).toBeDefined();
      expect(templatesCheck!.severity).toBe('pass');
    });

    it('warns when templates/ directory is missing', () => {
      verso(tmpDir, 'init --defaults');
      rmSync(join(tmpDir, '.verso', 'templates'), { recursive: true, force: true });

      const result = doctorJson(tmpDir);

      const templatesCheck = result.checks.find((c) => c.name === 'templates_dir');
      expect(templatesCheck).toBeDefined();
      expect(templatesCheck!.severity).toBe('warn');
    });
  });

  // ── Output format tests ────────────────────────────────────
  describe('output formats', () => {
    it('JSON output has correct structure', () => {
      verso(tmpDir, 'init --defaults');
      const result = doctorJson(tmpDir);

      expect(result).toHaveProperty('checks');
      expect(result).toHaveProperty('has_failures');
      expect(result).toHaveProperty('has_warnings');
      expect(Array.isArray(result.checks)).toBe(true);

      for (const check of result.checks) {
        expect(check).toHaveProperty('name');
        expect(check).toHaveProperty('severity');
        expect(check).toHaveProperty('message');
        expect(['pass', 'warn', 'fail']).toContain(check.severity);
      }
    });

    it('plain output lists all checks', () => {
      verso(tmpDir, 'init --defaults');
      const out = verso(tmpDir, 'doctor --format plain');
      const lines = out.trim().split('\n');

      // Each line should follow the pattern: name: severity - message
      // Names may contain hyphens (e.g., state-machine_yaml)
      for (const line of lines) {
        expect(line).toMatch(/^[\w-]+: (pass|warn|fail) - .+$/);
      }
    });
  });

  // ── Exit code ──────────────────────────────────────────────
  describe('exit codes', () => {
    it('exits 0 when all checks pass', () => {
      verso(tmpDir, 'init --defaults');
      // If this throws, the test fails (non-zero exit)
      const out = verso(tmpDir, 'doctor --format json');
      expect(out).toBeTruthy();
    });

    it('exits non-zero when checks fail', () => {
      // No .verso/ directory -> should fail
      const out = versoFail(tmpDir, 'doctor --format json');
      expect(out).toBeTruthy();
      const result = JSON.parse(out);
      expect(result.has_failures).toBe(true);
    });
  });
});
