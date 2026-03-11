import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { getTemplate } from './templates.js';

export type AiTool = 'claude-code' | 'cursor' | 'windsurf' | 'none';

/** Generate bridge files for the selected AI tool. Returns list of created files. */
export function generateBridge(projectRoot: string, tool: AiTool): string[] {
  switch (tool) {
    case 'claude-code':
      return generateClaudeCodeBridge(projectRoot);
    case 'cursor':
      return generateCursorBridge(projectRoot);
    case 'windsurf':
      return generateWindsurfBridge(projectRoot);
    case 'none':
      return [];
  }
}

function coreBridgeContent(): string {
  return [
    'This project uses the VERSO development framework.',
    '',
    'Your active pilot is `.verso/agents/pilot.md` -- read it and follow its instructions for all development tasks.',
    '',
    '### First-run check',
    '',
    'On every session start, verify:',
    '1. `.verso.yaml` exists -- if not, ask the user to configure it (name, GitHub handle, role)',
    '2. `.verso/config.yaml` is valid -- if not, offer to help fix it',
    '3. If anything is missing, offer to help: "Your VERSO setup is incomplete. Want me to help configure it?"',
    '',
    '### Core rules',
    '',
    '- Create issues in Captured state IMMEDIATELY when the user describes work -- capture first, refine later',
    '- Follow the VERSO state machine (`.verso/state-machine.yaml`) for all state transitions',
    '- Never close issues directly -- only a merged PR closes an issue',
    '- Respect WIP limits before starting new work',
    '- Use `verso` CLI commands to manage board state -- never edit YAML files directly',
  ].join('\n');
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function stripH1Heading(content: string): string {
  const lines = content.split('\n');
  if (lines.length === 0 || !lines[0].startsWith('# ')) {
    return content;
  }
  // Skip heading and any following blank lines
  let i = 1;
  while (i < lines.length && lines[i].trim() === '') {
    i++;
  }
  return lines.slice(i).join('\n');
}

function generateClaudeCodeBridge(projectRoot: string): string[] {
  const generated: string[] = [];

  // CLAUDE.md with VERSO section
  const claudeMdPath = join(projectRoot, 'CLAUDE.md');
  const versoSection = [
    '',
    '## VERSO Framework',
    '',
    '### Your role: Pilot (AI Orchestrator)',
    '',
    'On session start:',
    '1. Read `.verso/agents/pilot.md` -- this is your operating guide for the session',
    '2. Read `.verso.yaml` to confirm the user\'s role',
    '3. Read `.verso/config.yaml` for autonomy levels, WIP limits, and project settings',
    '4. Read `.verso/state-machine.yaml` for valid states and transitions',
    '',
    '### Agent delegation',
    '',
    'When work items need implementation, delegate to the Builder subagent.',
    'When PRs need review, delegate to the Reviewer subagent.',
    '',
    'These subagents are defined in `.claude/agents/builder.md` and `.claude/agents/reviewer.md`.',
    '',
    '### Core rules',
    '',
    '- Create issues in Captured state IMMEDIATELY when the user describes work -- capture first, refine later',
    '- Follow the VERSO state machine (`.verso/state-machine.yaml`) for all state transitions',
    '- Never close issues directly -- only a merged PR closes an issue',
    '- Respect WIP limits before starting new work',
    '- Use `verso` CLI commands to manage board state -- never edit YAML files directly',
    '',
  ].join('\n');

  if (existsSync(claudeMdPath)) {
    const existing = readFileSync(claudeMdPath, 'utf-8');
    if (!existing.includes('## VERSO Framework')) {
      writeFileSync(claudeMdPath, existing + versoSection, 'utf-8');
    }
  } else {
    writeFileSync(claudeMdPath, '# CLAUDE.md\n' + versoSection, 'utf-8');
  }
  generated.push('CLAUDE.md');

  // .claude/agents/builder.md
  const claudeAgentsDir = join(projectRoot, '.claude', 'agents');
  ensureDir(claudeAgentsDir);

  const builderRaw = getTemplate('agents/builder.md');
  if (builderRaw) {
    const builderBody = stripH1Heading(builderRaw);
    const builderContent =
      '---\n' +
      'name: builder\n' +
      'description: "VERSO Builder agent. Spawned by the Pilot to implement work items and create PRs."\n' +
      'tools: Read, Edit, Write, Bash, Grep, Glob\n' +
      'model: inherit\n' +
      '---\n\n' +
      builderBody;
    writeFileSync(join(claudeAgentsDir, 'builder.md'), builderContent, 'utf-8');
    generated.push('.claude/agents/builder.md');
  }

  // .claude/agents/reviewer.md
  const reviewerRaw = getTemplate('agents/reviewer.md');
  if (reviewerRaw) {
    const reviewerBody = stripH1Heading(reviewerRaw);
    const reviewerContent =
      '---\n' +
      'name: reviewer\n' +
      'description: "VERSO Reviewer agent. Spawned by the Pilot to review PRs against their original specs."\n' +
      'tools: Read, Bash, Grep, Glob\n' +
      'model: inherit\n' +
      '---\n\n' +
      reviewerBody;
    writeFileSync(join(claudeAgentsDir, 'reviewer.md'), reviewerContent, 'utf-8');
    generated.push('.claude/agents/reviewer.md');
  }

  return generated;
}

function generateCursorBridge(projectRoot: string): string[] {
  const cursorDir = join(projectRoot, '.cursor', 'rules');
  ensureDir(cursorDir);

  const content =
    '---\ndescription: VERSO development framework\nalwaysApply: true\n---\n\n' +
    coreBridgeContent() +
    '\n';

  writeFileSync(join(cursorDir, 'verso.mdc'), content, 'utf-8');
  return ['.cursor/rules/verso.mdc'];
}

function generateWindsurfBridge(projectRoot: string): string[] {
  const windsurfDir = join(projectRoot, '.windsurf', 'rules');
  ensureDir(windsurfDir);

  const content = '# VERSO Framework\n\n' + coreBridgeContent() + '\n';

  writeFileSync(join(windsurfDir, 'verso.md'), content, 'utf-8');
  return ['.windsurf/rules/verso.md'];
}
