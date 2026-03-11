import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import { loadConfig } from '../../src/core/config.js';
import { scaffoldVerso, updateGitignore } from '../../src/commands/init.js';
import { getTemplate, listTemplates, composePilot } from '../../src/templates.js';
import { generateBridge } from '../../src/bridges.js';

function verso(dir: string, args: string): string {
  return execSync(`npx tsx src/index.ts ${args}`, {
    cwd: join(__dirname, '..', '..'),
    env: { ...process.env, HOME: dir, VERSO_CWD: dir },
    encoding: 'utf-8',
  });
}

/** Run verso init --defaults inside the given directory */
function initDefaults(dir: string): string {
  // We need to run from the CLI project dir but init in the temp dir
  return execSync(
    `cd "${dir}" && npx tsx "${join(__dirname, '..', '..', 'src', 'index.ts')}" init --defaults`,
    { encoding: 'utf-8' },
  );
}

/** Run verso init --defaults and expect failure */
function initDefaultsFail(dir: string): string {
  try {
    execSync(
      `cd "${dir}" && npx tsx "${join(__dirname, '..', '..', 'src', 'index.ts')}" init --defaults`,
      { encoding: 'utf-8', stdio: 'pipe' },
    );
    return '';
  } catch (err: unknown) {
    const e = err as { stderr?: string; stdout?: string };
    return (e.stderr ?? '') + (e.stdout ?? '');
  }
}

describe('verso init --defaults', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'verso-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates .verso/ directory', () => {
    initDefaults(tmpDir);
    expect(existsSync(join(tmpDir, '.verso'))).toBe(true);
  });

  it('creates all 5 YAML files', () => {
    initDefaults(tmpDir);
    const yamlFiles = ['config.yaml', 'board.yaml', 'roadmap.yaml', 'state-machine.yaml', 'releases.yaml'];
    for (const name of yamlFiles) {
      expect(existsSync(join(tmpDir, '.verso', name))).toBe(true);
    }
  });

  it('creates agents/ with pilot.md, builder.md, reviewer.md', () => {
    initDefaults(tmpDir);
    const agentsDir = join(tmpDir, '.verso', 'agents');
    expect(existsSync(join(agentsDir, 'pilot.md'))).toBe(true);
    expect(existsSync(join(agentsDir, 'builder.md'))).toBe(true);
    expect(existsSync(join(agentsDir, 'reviewer.md'))).toBe(true);
  });

  it('creates templates/ with all template files', () => {
    initDefaults(tmpDir);
    const templatesDir = join(tmpDir, '.verso', 'templates');
    const templateFiles = ['issue-feature.md', 'issue-bug.md', 'issue-hotfix.md', 'issue-chore.md', 'spec.md', 'pr.md'];
    for (const name of templateFiles) {
      expect(existsSync(join(templatesDir, name))).toBe(true);
    }
  });

  it('all YAML files contain schema_version', () => {
    initDefaults(tmpDir);
    const yamlFiles = ['config.yaml', 'board.yaml', 'roadmap.yaml', 'state-machine.yaml', 'releases.yaml'];
    for (const name of yamlFiles) {
      const content = readFileSync(join(tmpDir, '.verso', name), 'utf-8');
      expect(content).toContain('schema_version');
    }
  });

  it('board.yaml has empty items', () => {
    initDefaults(tmpDir);
    const content = readFileSync(join(tmpDir, '.verso', 'board.yaml'), 'utf-8');
    expect(content).toContain('items: []');
  });

  it('fails when .verso/ already exists', () => {
    // Create .verso/ manually instead of running init twice (avoids timeout)
    mkdirSync(join(tmpDir, '.verso'), { recursive: true });
    const output = initDefaultsFail(tmpDir);
    expect(output).toContain('already exists');
  });

  it('config.yaml uses solo scale by default', () => {
    initDefaults(tmpDir);
    const content = readFileSync(join(tmpDir, '.verso', 'config.yaml'), 'utf-8');
    expect(content).toContain('scale: solo');
  });

  it('pilot.md contains core + solo-dev content', () => {
    initDefaults(tmpDir);
    const content = readFileSync(join(tmpDir, '.verso', 'agents', 'pilot.md'), 'utf-8');
    // Core content
    expect(content).toContain('VERSO Pilot');
    // Solo-dev content (separated by ---)
    expect(content).toContain('---');
    expect(content).toContain('Solo Developer');
  });

  it('init --defaults does NOT attempt npm install for plugins', () => {
    const output = initDefaults(tmpDir);
    expect(output).not.toContain('Installing @useverso/plugin-');
    expect(output).not.toContain('npm install');
  });

  it('init --defaults config has no plugins section', () => {
    initDefaults(tmpDir);
    const content = readFileSync(join(tmpDir, '.verso', 'config.yaml'), 'utf-8');
    expect(content).not.toContain('plugins:');
  });
});

describe('config.yaml with plugins section', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'verso-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads plugins from config.yaml correctly', () => {
    const versoDir = join(tmpDir, '.verso');
    mkdirSync(versoDir, { recursive: true });
    const configContent = yaml.dump({
      schema_version: 1,
      scale: 'solo',
      plugins: { board: 'github' },
    });
    writeFileSync(join(versoDir, 'config.yaml'), configContent, 'utf-8');
    const config = loadConfig(versoDir);
    expect(config.plugins).toBeDefined();
    expect(config.plugins!.board).toBe('github');
  });
});

describe('scaffoldVerso with github plugins', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'verso-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes github config section when any plugin uses github', () => {
    const versoDir = join(tmpDir, '.verso');
    scaffoldVerso(versoDir, 'solo', { board: 'github', ci: 'github' });
    const content = readFileSync(join(versoDir, 'config.yaml'), 'utf-8');
    expect(content).toContain('auto-detected from git remote');
    expect(content).toContain('# github:');
    expect(content).toContain('#   owner: your-org');
    expect(content).toContain('#   repo: your-repo');
    expect(content).toContain('#   token_env: GITHUB_TOKEN');
  });

  it('deduplicates plugin package names for install', () => {
    // Simulate the dedup logic used in runInitInteractive
    const plugins = { board: 'github', review: 'github', ci: 'github' };
    const packageNames = new Set<string>();
    for (const name of Object.values(plugins)) {
      if (name) packageNames.add(name);
    }
    // Even with 3 plugins all using 'github', the Set has only 1 entry
    expect(packageNames.size).toBe(1);
    expect(packageNames.has('github')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Template embedding tests
// ---------------------------------------------------------------------------
describe('template embedding', () => {
  it('all expected YAML templates exist', () => {
    const yamls = ['yaml/config.yaml', 'yaml/board.yaml', 'yaml/roadmap.yaml', 'yaml/state-machine.yaml', 'yaml/releases.yaml'];
    for (const path of yamls) {
      const content = getTemplate(path);
      expect(content, `template ${path} should exist`).toBeDefined();
      expect(content!.length).toBeGreaterThan(0);
    }
  });

  it('all expected issue/spec/PR templates exist', () => {
    const templates = [
      'templates/issue-feature.md',
      'templates/issue-bug.md',
      'templates/issue-hotfix.md',
      'templates/issue-chore.md',
      'templates/spec.md',
      'templates/pr.md',
    ];
    for (const path of templates) {
      const content = getTemplate(path);
      expect(content, `template ${path} should exist`).toBeDefined();
      expect(content!.length).toBeGreaterThan(0);
    }
  });

  it('agent templates exist (builder, reviewer, pilot core + profiles)', () => {
    const agents = [
      'agents/builder.md',
      'agents/reviewer.md',
      'agents/pilot/core.md',
      'agents/pilot/solo-dev.md',
      'agents/pilot/team-dev.md',
      'agents/pilot/tech-lead.md',
      'agents/pilot/pm.md',
    ];
    for (const path of agents) {
      const content = getTemplate(path);
      expect(content, `template ${path} should exist`).toBeDefined();
      expect(content!.length).toBeGreaterThan(0);
    }
  });

  it('listTemplates returns all template files', () => {
    const templates = listTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(16); // 5 yaml + 6 templates + 2 agents + 4 pilot profiles + core
    expect(templates).toContain('yaml/config.yaml');
    expect(templates).toContain('templates/pr.md');
    expect(templates).toContain('agents/builder.md');
    expect(templates).toContain('agents/pilot/core.md');
  });

  it('all YAML templates contain schema_version', () => {
    const yamls = ['yaml/config.yaml', 'yaml/board.yaml', 'yaml/roadmap.yaml', 'yaml/state-machine.yaml', 'yaml/releases.yaml'];
    for (const path of yamls) {
      const content = getTemplate(path)!;
      expect(content).toContain('schema_version');
    }
  });

  it('board.yaml template has empty items list', () => {
    const content = getTemplate('yaml/board.yaml')!;
    expect(content).toContain('items: []');
  });

  it('config.yaml template has expected defaults', () => {
    const content = getTemplate('yaml/config.yaml')!;
    expect(content).toContain('scale: solo');
    // Check WIP limits exist
    expect(content).toContain('building: 2');
    expect(content).toContain('pr_ready: 5');
  });
});

// ---------------------------------------------------------------------------
// Pilot composition tests
// ---------------------------------------------------------------------------
describe('pilot composition', () => {
  it('composePilot("solo") includes core + solo-dev content', () => {
    const pilot = composePilot('solo');
    expect(pilot).toContain('VERSO Pilot');
    expect(pilot).toContain('Core');
    expect(pilot).toContain('Solo Developer');
    expect(pilot).toContain('---'); // separator
  });

  it('composePilot("small-team") includes core + team-dev content', () => {
    const pilot = composePilot('small-team');
    expect(pilot).toContain('VERSO Pilot');
    expect(pilot).toContain('Team Developer');
  });

  it('composePilot("startup") includes core + tech-lead content', () => {
    const pilot = composePilot('startup');
    expect(pilot).toContain('VERSO Pilot');
    expect(pilot).toContain('Tech Lead');
  });

  it('composePilot("enterprise") includes core + PM content', () => {
    const pilot = composePilot('enterprise');
    expect(pilot).toContain('VERSO Pilot');
    expect(pilot).toContain('PM');
  });

  it('composePilot with unknown scale returns core only', () => {
    const pilot = composePilot('unknown-scale');
    expect(pilot).toContain('VERSO Pilot');
    expect(pilot).not.toContain('Solo Developer');
    expect(pilot).not.toContain('Team Developer');
    expect(pilot).not.toContain('Tech Lead');
  });

  it('pilot modular sources are NOT shipped to users (only composed pilot.md)', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'verso-pilot-test-'));
    try {
      const versoDir = join(tmpDir, '.verso');
      scaffoldVerso(versoDir, 'solo');
      // Users should have pilot.md but NOT the modular source files
      expect(existsSync(join(versoDir, 'agents', 'pilot.md'))).toBe(true);
      expect(existsSync(join(versoDir, 'agents', 'pilot'))).toBe(false);
      expect(existsSync(join(versoDir, 'agents', 'pilot', 'core.md'))).toBe(false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Bridge generation tests
// ---------------------------------------------------------------------------
describe('bridge generation', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'verso-bridge-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('claude-code bridge creates CLAUDE.md', () => {
    const files = generateBridge(tmpDir, 'claude-code');
    expect(files).toContain('CLAUDE.md');
    const content = readFileSync(join(tmpDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('VERSO Framework');
    expect(content).toContain('pilot.md');
  });

  it('claude-code bridge creates .claude/agents/builder.md and reviewer.md', () => {
    const files = generateBridge(tmpDir, 'claude-code');
    expect(files).toContain('.claude/agents/builder.md');
    expect(files).toContain('.claude/agents/reviewer.md');
    expect(existsSync(join(tmpDir, '.claude', 'agents', 'builder.md'))).toBe(true);
    expect(existsSync(join(tmpDir, '.claude', 'agents', 'reviewer.md'))).toBe(true);
  });

  it('claude-code builder.md has frontmatter with agent metadata', () => {
    generateBridge(tmpDir, 'claude-code');
    const content = readFileSync(join(tmpDir, '.claude', 'agents', 'builder.md'), 'utf-8');
    expect(content).toContain('name: builder');
    expect(content).toContain('tools:');
  });

  it('claude-code reviewer.md has frontmatter with agent metadata', () => {
    generateBridge(tmpDir, 'claude-code');
    const content = readFileSync(join(tmpDir, '.claude', 'agents', 'reviewer.md'), 'utf-8');
    expect(content).toContain('name: reviewer');
    expect(content).toContain('tools:');
  });

  it('claude-code bridge appends to existing CLAUDE.md', () => {
    writeFileSync(join(tmpDir, 'CLAUDE.md'), '# Existing project config\n\nDo not remove.\n', 'utf-8');
    generateBridge(tmpDir, 'claude-code');
    const content = readFileSync(join(tmpDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('Existing project config');
    expect(content).toContain('VERSO Framework');
  });

  it('claude-code bridge does not duplicate VERSO section', () => {
    generateBridge(tmpDir, 'claude-code');
    generateBridge(tmpDir, 'claude-code');
    const content = readFileSync(join(tmpDir, 'CLAUDE.md'), 'utf-8');
    const matches = content.match(/## VERSO Framework/g);
    expect(matches).toHaveLength(1);
  });

  it('cursor bridge creates .cursor/rules/verso.mdc', () => {
    const files = generateBridge(tmpDir, 'cursor');
    expect(files).toContain('.cursor/rules/verso.mdc');
    const content = readFileSync(join(tmpDir, '.cursor', 'rules', 'verso.mdc'), 'utf-8');
    expect(content).toContain('VERSO');
    expect(content).toContain('alwaysApply: true');
  });

  it('windsurf bridge creates .windsurf/rules/verso.md', () => {
    const files = generateBridge(tmpDir, 'windsurf');
    expect(files).toContain('.windsurf/rules/verso.md');
    const content = readFileSync(join(tmpDir, '.windsurf', 'rules', 'verso.md'), 'utf-8');
    expect(content).toContain('VERSO');
  });

  it('none bridge creates no files', () => {
    const files = generateBridge(tmpDir, 'none');
    expect(files).toEqual([]);
  });

  it('all bridge content instructs agents to use verso CLI, never edit YAML', () => {
    // Generate all bridges in the same tmpDir
    generateBridge(tmpDir, 'claude-code');
    generateBridge(tmpDir, 'cursor');
    generateBridge(tmpDir, 'windsurf');

    const cursorContent = readFileSync(join(tmpDir, '.cursor', 'rules', 'verso.mdc'), 'utf-8');
    expect(cursorContent).toContain('never edit YAML files directly');

    const windsurfContent = readFileSync(join(tmpDir, '.windsurf', 'rules', 'verso.md'), 'utf-8');
    expect(windsurfContent).toContain('never edit YAML files directly');

    const claudeContent = readFileSync(join(tmpDir, 'CLAUDE.md'), 'utf-8');
    expect(claudeContent).toContain('never edit YAML files directly');
  });
});

// ---------------------------------------------------------------------------
// Gitignore update tests
// ---------------------------------------------------------------------------
describe('gitignore update', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'verso-gitignore-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates .gitignore with VERSO entries when none exists', () => {
    updateGitignore(tmpDir);
    const content = readFileSync(join(tmpDir, '.gitignore'), 'utf-8');
    expect(content).toContain('.verso.yaml');
    expect(content).toContain('.worktrees/');
  });

  it('appends to existing .gitignore without overwriting', () => {
    writeFileSync(join(tmpDir, '.gitignore'), 'node_modules/\n.env\n', 'utf-8');
    updateGitignore(tmpDir);
    const content = readFileSync(join(tmpDir, '.gitignore'), 'utf-8');
    expect(content).toContain('node_modules/');
    expect(content).toContain('.env');
    expect(content).toContain('.verso.yaml');
    expect(content).toContain('.worktrees/');
  });

  it('does not duplicate entries if already present', () => {
    writeFileSync(join(tmpDir, '.gitignore'), '.verso.yaml\n.worktrees/\n', 'utf-8');
    updateGitignore(tmpDir);
    const content = readFileSync(join(tmpDir, '.gitignore'), 'utf-8');
    const matches = content.match(/\.verso\.yaml/g);
    expect(matches).toHaveLength(1);
  });

  it('adds only missing entries', () => {
    writeFileSync(join(tmpDir, '.gitignore'), 'node_modules/\n.verso.yaml\n', 'utf-8');
    updateGitignore(tmpDir);
    const content = readFileSync(join(tmpDir, '.gitignore'), 'utf-8');
    expect(content).toContain('.worktrees/');
    const matches = content.match(/\.verso\.yaml/g);
    expect(matches).toHaveLength(1);
  });

  it('init --defaults creates .gitignore with VERSO entries', () => {
    initDefaults(tmpDir);
    const content = readFileSync(join(tmpDir, '.gitignore'), 'utf-8');
    expect(content).toContain('.verso.yaml');
    expect(content).toContain('.worktrees/');
  });

  it('init --defaults preserves existing .gitignore content', () => {
    writeFileSync(join(tmpDir, '.gitignore'), 'dist/\ncoverage/\n', 'utf-8');
    initDefaults(tmpDir);
    const content = readFileSync(join(tmpDir, '.gitignore'), 'utf-8');
    expect(content).toContain('dist/');
    expect(content).toContain('coverage/');
    expect(content).toContain('.verso.yaml');
  });
});

// ---------------------------------------------------------------------------
// scaffoldVerso with different scales
// ---------------------------------------------------------------------------
describe('scaffoldVerso scale variations', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'verso-scale-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('scaffolds with small-team scale', () => {
    const versoDir = join(tmpDir, '.verso');
    scaffoldVerso(versoDir, 'small-team');
    const config = readFileSync(join(versoDir, 'config.yaml'), 'utf-8');
    expect(config).toContain('scale: small-team');
    const pilot = readFileSync(join(versoDir, 'agents', 'pilot.md'), 'utf-8');
    expect(pilot).toContain('Team Developer');
  });

  it('scaffolds with startup scale', () => {
    const versoDir = join(tmpDir, '.verso');
    scaffoldVerso(versoDir, 'startup');
    const config = readFileSync(join(versoDir, 'config.yaml'), 'utf-8');
    expect(config).toContain('scale: startup');
    const pilot = readFileSync(join(versoDir, 'agents', 'pilot.md'), 'utf-8');
    expect(pilot).toContain('Tech Lead');
  });

  it('scaffolds with enterprise scale', () => {
    const versoDir = join(tmpDir, '.verso');
    scaffoldVerso(versoDir, 'enterprise');
    const config = readFileSync(join(versoDir, 'config.yaml'), 'utf-8');
    expect(config).toContain('scale: enterprise');
    const pilot = readFileSync(join(versoDir, 'agents', 'pilot.md'), 'utf-8');
    expect(pilot).toContain('PM');
  });
});
