import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateBridges } from '../../src/lib/bridges.js';

let tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'verso-test-bridges-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe('generateBridges', () => {
  it('always generates AGENTS.md', async () => {
    const dir = await makeTempDir();

    const files = await generateBridges(dir, 'other', 'solo-dev');

    expect(files).toContain('AGENTS.md');
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true);

    const content = await readFile(join(dir, 'AGENTS.md'), 'utf-8');
    expect(content).toContain('# AGENTS.md');
    expect(content).toContain('VERSO');
  });

  it('generates CLAUDE.md and .claude/agents/ for claude tool', async () => {
    const dir = await makeTempDir();

    const files = await generateBridges(dir, 'claude', 'solo-dev');

    expect(files).toContain('AGENTS.md');
    expect(files).toContain('CLAUDE.md');
    expect(files).toContain('.claude/agents/builder.md');
    expect(files).toContain('.claude/agents/reviewer.md');
    // pilot.md should NOT be generated
    expect(files).not.toContain('.claude/agents/pilot.md');

    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(dir, '.claude', 'agents', 'builder.md'))).toBe(true);
    expect(existsSync(join(dir, '.claude', 'agents', 'reviewer.md'))).toBe(true);
    expect(existsSync(join(dir, '.claude', 'agents', 'pilot.md'))).toBe(false);

    const claudeContent = await readFile(join(dir, 'CLAUDE.md'), 'utf-8');
    expect(claudeContent).toContain('## VERSO Framework');
    expect(claudeContent).toContain('Your role: Pilot (AI Orchestrator)');
    expect(claudeContent).toContain('Agent delegation');
  });

  it('generates builder.md with YAML frontmatter and template content', async () => {
    const dir = await makeTempDir();

    await generateBridges(dir, 'claude', 'solo-dev');

    const content = await readFile(join(dir, '.claude', 'agents', 'builder.md'), 'utf-8');
    // Check frontmatter
    expect(content).toMatch(/^---\n/);
    expect(content).toContain('name: builder');
    expect(content).toContain('tools: Read, Edit, Write, Bash, Grep, Glob');
    expect(content).toContain('model: inherit');
    // Check body content comes from template
    expect(content).toContain('## Identity');
    expect(content).toContain('Builder agent');
  });

  it('generates reviewer.md with YAML frontmatter and template content', async () => {
    const dir = await makeTempDir();

    await generateBridges(dir, 'claude', 'solo-dev');

    const content = await readFile(join(dir, '.claude', 'agents', 'reviewer.md'), 'utf-8');
    // Check frontmatter
    expect(content).toMatch(/^---\n/);
    expect(content).toContain('name: reviewer');
    expect(content).toContain('tools: Read, Bash, Grep, Glob');
    expect(content).toContain('model: inherit');
    // Reviewer should NOT have Edit or Write tools
    expect(content).not.toMatch(/tools:.*Edit/);
    expect(content).not.toMatch(/tools:.*Write/);
    // Check body content comes from template
    expect(content).toContain('## Identity');
    expect(content).toContain('Reviewer agent');
  });

  it('generates .cursor/rules/ for cursor tool', async () => {
    const dir = await makeTempDir();

    const files = await generateBridges(dir, 'cursor', 'solo-dev');

    expect(files).toContain('.cursor/rules/verso.mdc');
    expect(existsSync(join(dir, '.cursor', 'rules', 'verso.mdc'))).toBe(true);

    const content = await readFile(join(dir, '.cursor', 'rules', 'verso.mdc'), 'utf-8');
    expect(content).toContain('VERSO');
    expect(content).toContain('alwaysApply: true');
  });

  it('generates GEMINI.md for gemini tool', async () => {
    const dir = await makeTempDir();

    const files = await generateBridges(dir, 'gemini', 'solo-dev');

    expect(files).toContain('GEMINI.md');
    expect(existsSync(join(dir, 'GEMINI.md'))).toBe(true);

    const content = await readFile(join(dir, 'GEMINI.md'), 'utf-8');
    expect(content).toContain('# GEMINI.md');
    expect(content).toContain('VERSO');
  });

  it('generates .windsurf/rules/ for windsurf tool', async () => {
    const dir = await makeTempDir();

    const files = await generateBridges(dir, 'windsurf', 'solo-dev');

    expect(files).toContain('.windsurf/rules/verso.md');
    expect(existsSync(join(dir, '.windsurf', 'rules', 'verso.md'))).toBe(true);
  });

  it('generates .clinerules/ for cline tool', async () => {
    const dir = await makeTempDir();

    const files = await generateBridges(dir, 'cline', 'solo-dev');

    expect(files).toContain('.clinerules/verso.md');
    expect(existsSync(join(dir, '.clinerules', 'verso.md'))).toBe(true);
  });

  it('codex only generates AGENTS.md (no extra files)', async () => {
    const dir = await makeTempDir();

    const files = await generateBridges(dir, 'codex', 'solo-dev');

    expect(files).toEqual(['AGENTS.md']);
  });

  it('other tool only generates AGENTS.md', async () => {
    const dir = await makeTempDir();

    const files = await generateBridges(dir, 'other', 'solo-dev');

    expect(files).toEqual(['AGENTS.md']);
  });

  it('appends to existing CLAUDE.md if present', async () => {
    const dir = await makeTempDir();

    // Pre-create a CLAUDE.md with existing content
    const existingContent = '# CLAUDE.md\n\n## Existing Section\n\nSome existing rules.\n';
    await writeFile(join(dir, 'CLAUDE.md'), existingContent);

    await generateBridges(dir, 'claude', 'solo-dev');

    const content = await readFile(join(dir, 'CLAUDE.md'), 'utf-8');
    // Should contain both original and appended content
    expect(content).toContain('## Existing Section');
    expect(content).toContain('## VERSO Framework');
  });

  it('does not duplicate VERSO section if already in CLAUDE.md', async () => {
    const dir = await makeTempDir();

    // Pre-create a CLAUDE.md that already has the VERSO section
    const existingContent = '# CLAUDE.md\n\n## VERSO Framework\n\nAlready there.\n';
    await writeFile(join(dir, 'CLAUDE.md'), existingContent);

    await generateBridges(dir, 'claude', 'solo-dev');

    const content = await readFile(join(dir, 'CLAUDE.md'), 'utf-8');
    // Should appear only once
    const matches = content.match(/## VERSO Framework/g);
    expect(matches).toHaveLength(1);
  });

  it('uses the correct pilot file for different roles', async () => {
    const dir = await makeTempDir();

    await generateBridges(dir, 'claude', 'tech-lead');

    const agentsMd = await readFile(join(dir, 'AGENTS.md'), 'utf-8');
    expect(agentsMd).toContain('pilot-tech-lead.md');
  });

  it('references pilot.md for solo-dev role', async () => {
    const dir = await makeTempDir();

    await generateBridges(dir, 'gemini', 'solo-dev');

    const content = await readFile(join(dir, 'GEMINI.md'), 'utf-8');
    expect(content).toContain('.verso/agents/pilot.md');
  });

  it('CLAUDE.md includes pilot role mapping table', async () => {
    const dir = await makeTempDir();

    await generateBridges(dir, 'claude', 'solo-dev');

    const content = await readFile(join(dir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('solo-dev');
    expect(content).toContain('team-dev');
    expect(content).toContain('tech-lead');
    expect(content).toContain('.verso/agents/pilot-pm.md');
  });
});
