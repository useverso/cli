import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { AiTool, Role } from '../types/index.js';
import { getTemplatesDir } from './templates.js';

// ---------------------------------------------------------------------------
// Core bridge content
// ---------------------------------------------------------------------------

function coreBridgeContent(_role: Role): string {
  return [
    'This project uses the VERSO development framework.',
    '',
    'Your active pilot is `.verso/agents/pilot.md` — read it and follow its instructions for all development tasks.',
    '',
    '### First-run check',
    '',
    'On every session start, verify:',
    '1. `.verso.yaml` exists — if not, ask the user to configure it (name, GitHub handle, role)',
    '2. `.verso/config.yaml` has `board.github.owner` set — if not, the project board is not linked',
    '3. If anything is missing, offer to help: "Your VERSO setup is incomplete. Want me to help configure it?"',
    '',
    '### Core rules',
    '',
    '- Create issues in Captured state IMMEDIATELY when the user describes work — capture first, refine later',
    '- Always add issues to the project board (read board config from `.verso/config.yaml`)',
    '- Follow the VERSO state machine (`.verso/state-machine.yaml`) for all state transitions',
    '- Never close issues directly — only a merged PR closes an issue',
    '- Respect WIP limits before starting new work',
    '- Do not duplicate Project field data (Type, Priority, Status) in issue bodies',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

async function writeNewFile(filePath: string, content: string): Promise<void> {
  await ensureDir(dirname(filePath));
  await writeFile(filePath, content, 'utf-8');
}

/**
 * Read a template file from the bundled templates directory.
 * Strips the first H1 heading line (e.g. "# VERSO Builder ...") since the
 * Claude Code frontmatter already carries the agent name.
 */
async function readTemplateAgent(fileName: string): Promise<string> {
  const templatesDir = getTemplatesDir();
  const filePath = join(templatesDir, '.verso', 'agents', fileName);
  const raw = await readFile(filePath, 'utf-8');

  // Strip the first line if it is an H1 heading
  const lines = raw.split('\n');
  const startIndex = lines.length > 0 && lines[0].startsWith('# ') ? 1 : 0;

  // Also strip any leading blank lines after the heading
  let i = startIndex;
  while (i < lines.length && lines[i].trim() === '') {
    i++;
  }

  return lines.slice(i).join('\n').trimEnd() + '\n';
}

// ---------------------------------------------------------------------------
// AGENTS.md (always generated)
// ---------------------------------------------------------------------------

async function generateAgentsMd(projectRoot: string, role: Role): Promise<void> {
  const content = [
    '# AGENTS.md',
    '',
    coreBridgeContent(role),
    '',
  ].join('\n');

  await writeNewFile(join(projectRoot, 'AGENTS.md'), content);
}

// ---------------------------------------------------------------------------
// Claude Code bridge
// ---------------------------------------------------------------------------

async function generateClaudeBridge(projectRoot: string, role: Role): Promise<string[]> {
  const generated: string[] = [];

  // ---- CLAUDE.md — the Pilot lives here ----
  const claudeMdPath = join(projectRoot, 'CLAUDE.md');
  const versoSection = [
    '',
    '## VERSO Framework',
    '',
    '### Your role: Pilot (AI Orchestrator)',
    '',
    'On session start:',
    '1. Read `.verso/agents/pilot.md` — this is your operating guide for the session',
    '2. Read `.verso.yaml` to confirm the user\'s role',
    '3. Read `.verso/config.yaml` for autonomy levels, WIP limits, and project settings',
    '4. Read `.verso/state-machine.yaml` for valid states and transitions',
    '',
    '### First-run check',
    '',
    'On every session start, verify:',
    '1. `.verso.yaml` exists — if not, ask the user to configure it (name, GitHub handle, role)',
    '2. `.verso/config.yaml` has `board.github.owner` set — if not, the project board is not linked',
    '3. If anything is missing, offer to help: "Your VERSO setup is incomplete. Want me to help configure it?"',
    '',
    '### Agent delegation',
    '',
    'When work items need implementation, delegate to the Builder subagent.',
    'When PRs need review, delegate to the Reviewer subagent.',
    '',
    'These subagents are defined in `.claude/agents/builder.md` and `.claude/agents/reviewer.md`.',
    '',
    '**How to invoke:**',
    '',
    'To delegate to the Builder:',
    '```',
    'Task(subagent_type="builder", description="Implement #{id}: [include full spec, acceptance criteria, target branch, relevant file paths, and worktree path]")',
    '```',
    '',
    'To delegate to the Reviewer:',
    '```',
    'Task(subagent_type="reviewer", description="Review PR #{pr} for #{id}: [include spec, acceptance criteria, and PR URL]")',
    '```',
    '',
    'Subagents run in their own context and have no access to your conversation history. You MUST include all relevant context in the task description.',
    '',
    '### Core rules',
    '',
    '- Create issues in Captured state IMMEDIATELY when the user describes work — capture first, refine later',
    '- Always add issues to the project board (read board config from `.verso/config.yaml`)',
    '- Follow the VERSO state machine (`.verso/state-machine.yaml`) for all state transitions',
    '- Never close issues directly — only a merged PR closes an issue',
    '- Respect WIP limits before starting new work',
    '- Do not duplicate Project field data (Type, Priority, Status) in issue bodies',
    '',
  ].join('\n');

  if (existsSync(claudeMdPath)) {
    const existing = await readFile(claudeMdPath, 'utf-8');
    if (!existing.includes('## VERSO Framework')) {
      await appendFile(claudeMdPath, versoSection, 'utf-8');
    }
  } else {
    const content = ['# CLAUDE.md', versoSection].join('\n');
    await writeNewFile(claudeMdPath, content);
  }
  generated.push('CLAUDE.md');

  // ---- .claude/agents/builder.md — Builder subagent ----
  const builderBody = await readTemplateAgent('builder.md');
  const builderContent = [
    '---',
    'name: builder',
    'description: "VERSO Builder agent. Use when a work item needs implementation. Spawned by the Pilot to build features, fix bugs, and create PRs."',
    'tools: Read, Edit, Write, Bash, Grep, Glob',
    'model: inherit',
    '---',
    '',
    builderBody,
  ].join('\n');

  await writeNewFile(join(projectRoot, '.claude', 'agents', 'builder.md'), builderContent);
  generated.push('.claude/agents/builder.md');

  // ---- .claude/agents/reviewer.md — Reviewer subagent ----
  const reviewerBody = await readTemplateAgent('reviewer.md');
  const reviewerContent = [
    '---',
    'name: reviewer',
    'description: "VERSO Reviewer agent. Use when a PR needs code review. Spawned by the Pilot to review PRs against their original specs."',
    'tools: Read, Bash, Grep, Glob',
    'model: inherit',
    '---',
    '',
    reviewerBody,
  ].join('\n');

  await writeNewFile(join(projectRoot, '.claude', 'agents', 'reviewer.md'), reviewerContent);
  generated.push('.claude/agents/reviewer.md');

  return generated;
}

// ---------------------------------------------------------------------------
// Gemini CLI bridge
// ---------------------------------------------------------------------------

async function generateGeminiBridge(projectRoot: string, role: Role): Promise<string[]> {
  const content = [
    '# GEMINI.md',
    '',
    coreBridgeContent(role),
    '',
  ].join('\n');

  await writeNewFile(join(projectRoot, 'GEMINI.md'), content);
  return ['GEMINI.md'];
}

// ---------------------------------------------------------------------------
// Cursor bridge
// ---------------------------------------------------------------------------

async function generateCursorBridge(projectRoot: string, role: Role): Promise<string[]> {
  const content = [
    '---',
    'description: VERSO development framework',
    'alwaysApply: true',
    '---',
    '',
    coreBridgeContent(role),
    '',
  ].join('\n');

  const filePath = join(projectRoot, '.cursor', 'rules', 'verso.mdc');
  await writeNewFile(filePath, content);
  return ['.cursor/rules/verso.mdc'];
}

// ---------------------------------------------------------------------------
// Windsurf bridge
// ---------------------------------------------------------------------------

async function generateWindsurfBridge(projectRoot: string, role: Role): Promise<string[]> {
  const content = [
    '# VERSO Framework',
    '',
    coreBridgeContent(role),
    '',
  ].join('\n');

  const filePath = join(projectRoot, '.windsurf', 'rules', 'verso.md');
  await writeNewFile(filePath, content);
  return ['.windsurf/rules/verso.md'];
}

// ---------------------------------------------------------------------------
// Cline bridge
// ---------------------------------------------------------------------------

async function generateClineBridge(projectRoot: string, role: Role): Promise<string[]> {
  const content = [
    '# VERSO Framework',
    '',
    coreBridgeContent(role),
    '',
  ].join('\n');

  const filePath = join(projectRoot, '.clinerules', 'verso.md');
  await writeNewFile(filePath, content);
  return ['.clinerules/verso.md'];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate all bridge files for the selected AI tool.
 * Always generates AGENTS.md as a baseline.
 */
export async function generateBridges(
  projectRoot: string,
  aiTool: AiTool,
  role: Role,
): Promise<string[]> {
  const generated: string[] = [];

  // Always generate AGENTS.md
  await generateAgentsMd(projectRoot, role);
  generated.push('AGENTS.md');

  // Generate tool-specific bridge
  switch (aiTool) {
    case 'claude':
      generated.push(...await generateClaudeBridge(projectRoot, role));
      break;
    case 'gemini':
      generated.push(...await generateGeminiBridge(projectRoot, role));
      break;
    case 'cursor':
      generated.push(...await generateCursorBridge(projectRoot, role));
      break;
    case 'windsurf':
      generated.push(...await generateWindsurfBridge(projectRoot, role));
      break;
    case 'cline':
      generated.push(...await generateClineBridge(projectRoot, role));
      break;
    case 'codex':
      // Codex uses AGENTS.md natively — no extra bridge needed
      break;
    case 'other':
      // No bridge — user sets up manually
      break;
  }

  return generated;
}
