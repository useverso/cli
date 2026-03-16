import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { Command } from 'commander';

import * as board from '../core/board.js';
import type { WorkType } from '../core/types.js';
import type { OutputFormat } from '../output.js';
import * as output from '../output.js';

function getFormat(cmd: Command): OutputFormat {
  return cmd.optsWithGlobals().format ?? 'human';
}

function versoDir(): string {
  const dir = `${process.cwd()}/.verso`;
  if (!fs.existsSync(dir)) {
    console.error('.verso directory not found in current directory');
    process.exit(1);
  }
  return dir;
}

function worktreesDir(): string {
  return `${process.cwd()}/.worktrees`;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

const TYPE_PREFIXES: Record<string, string> = {
  feature: 'feat',
  bug: 'fix',
  hotfix: 'hotfix',
  refactor: 'refactor',
  chore: 'chore',
};

function branchName(type: WorkType, id: number, title: string): string {
  const prefix = TYPE_PREFIXES[type] ?? type;
  const slug = slugify(title);
  return `${prefix}/${id}-${slug}`;
}

function isGitRepo(): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

interface WorktreeEntry {
  id: number;
  directory: string;
  branch: string;
}

function listWorktreeEntries(dir: string, boardFile: board.BoardFile): WorktreeEntry[] {
  const wtDir = worktreesDir();
  if (!fs.existsSync(wtDir)) return [];

  const entries: WorktreeEntry[] = [];
  const dirs = fs.readdirSync(wtDir, { withFileTypes: true });

  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const match = d.name.match(/^(\d+)-/);
    if (!match) continue;
    const itemId = parseInt(match[1], 10);
    const item = board.getItem(boardFile, itemId);
    entries.push({
      id: itemId,
      directory: d.name,
      branch: item?.branch ?? '',
    });
  }

  return entries;
}

function findWorktreeDirForId(id: number): string | undefined {
  const wtDir = worktreesDir();
  if (!fs.existsSync(wtDir)) return undefined;

  const dirs = fs.readdirSync(wtDir, { withFileTypes: true });
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const match = d.name.match(/^(\d+)-/);
    if (match && parseInt(match[1], 10) === id) {
      return d.name;
    }
  }
  return undefined;
}

export function registerWorktreeCommand(program: Command): void {
  const wtCmd = program
    .command('worktree')
    .description('Manage git worktrees for work items');

  wtCmd
    .command('list')
    .description('List all worktrees')
    .action(() => {
      const format = getFormat(wtCmd);
      const dir = versoDir();
      const boardFile = board.loadBoard(dir);
      const entries = listWorktreeEntries(dir, boardFile);

      switch (format) {
        case 'human':
          if (entries.length === 0) {
            console.log('No worktrees.');
            return;
          }
          for (const e of entries) {
            console.log(`  #${e.id}  ${e.directory}  ${e.branch}`);
          }
          break;
        case 'plain':
          for (const e of entries) {
            console.log(`id: ${e.id}`);
            console.log(`directory: ${e.directory}`);
            console.log(`branch: ${e.branch}`);
          }
          break;
        case 'json':
          console.log(JSON.stringify(entries, null, 2));
          break;
      }
    });

  wtCmd
    .command('add')
    .description('Create a worktree for a work item')
    .argument('<id>', 'Item ID', parseInt)
    .action((id: number) => {
      const format = getFormat(wtCmd);
      const dir = versoDir();

      if (!isGitRepo()) {
        output.printError('not in a git repository', format);
        process.exit(1);
      }

      const boardFile = board.loadBoard(dir);
      const item = board.getItem(boardFile, id);
      if (!item) {
        output.printError(`item #${id} not found`, format);
        process.exit(1);
      }

      const branch = branchName(item.type, item.id, item.title);
      const slug = slugify(item.title);
      const dirName = `${id}-${slug}`;
      const wtPath = `${worktreesDir()}/${dirName}`;

      if (fs.existsSync(wtPath)) {
        output.printError(`worktree for #${id} already exists at .worktrees/${dirName}`, format);
        process.exit(1);
      }

      // Create .worktrees/ if it does not exist
      if (!fs.existsSync(worktreesDir())) {
        fs.mkdirSync(worktreesDir(), { recursive: true });
      }

      try {
        execSync(`git worktree add -b "${branch}" "${wtPath}"`, {
          stdio: 'pipe',
          encoding: 'utf-8',
        });
      } catch (err: unknown) {
        const e = err as { stderr?: string };
        output.printError(`git worktree add failed: ${e.stderr ?? 'unknown error'}`, format);
        process.exit(1);
      }

      // Update board item branch field
      board.updateItem(boardFile, id, { branch });
      board.saveBoard(dir, boardFile);

      switch (format) {
        case 'human':
          console.log(`Created worktree .worktrees/${dirName} on branch ${branch}`);
          break;
        case 'plain':
          console.log(`id: ${id}`);
          console.log(`directory: ${dirName}`);
          console.log(`branch: ${branch}`);
          break;
        case 'json':
          console.log(JSON.stringify({ id, directory: dirName, branch }, null, 2));
          break;
      }
    });

  wtCmd
    .command('remove')
    .description('Remove a worktree for a work item')
    .argument('<id>', 'Item ID', parseInt)
    .action((id: number) => {
      const format = getFormat(wtCmd);
      const dir = versoDir();

      const dirName = findWorktreeDirForId(id);
      if (!dirName) {
        output.printError(`worktree for #${id} not found`, format);
        process.exit(1);
      }

      const wtPath = `${worktreesDir()}/${dirName}`;

      try {
        execSync(`git worktree remove "${wtPath}"`, {
          stdio: 'pipe',
          encoding: 'utf-8',
        });
      } catch (err: unknown) {
        const e = err as { stderr?: string };
        output.printError(`git worktree remove failed: ${e.stderr ?? 'unknown error'}`, format);
        process.exit(1);
      }

      // Clear the branch field on the board item
      const boardFile = board.loadBoard(dir);
      const item = board.getItem(boardFile, id);
      if (item) {
        board.updateItem(boardFile, id, { branch: '' });
        board.saveBoard(dir, boardFile);
      }

      switch (format) {
        case 'human':
          console.log(`Removed worktree .worktrees/${dirName}`);
          break;
        case 'plain':
          console.log(`id: ${id}`);
          console.log(`removed: ${dirName}`);
          break;
        case 'json':
          console.log(JSON.stringify({ id, removed: dirName }, null, 2));
          break;
      }
    });
}
