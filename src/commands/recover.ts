import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';

import * as board from '../core/board.js';
import type { BoardItem } from '../core/types.js';
import type { OutputFormat } from '../output.js';
import * as ui from '../ui.js';

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

export interface RecoveryIssue {
  itemId: number;
  title: string;
  state: string;
  issueType: 'orphaned_build' | 'stale_review' | 'empty_blocked_reason';
  suggestedAction: string;
}

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

function checkOrphanedBuild(item: BoardItem, cwd: string): RecoveryIssue | null {
  if (item.state !== 'building') return null;

  const worktreesDir = path.join(cwd, '.worktrees');
  if (!fs.existsSync(worktreesDir)) {
    return {
      itemId: item.id,
      title: item.title,
      state: item.state,
      issueType: 'orphaned_build',
      suggestedAction: `Move item #${item.id} back to queued — no worktree found`,
    };
  }

  // Check if any directory in .worktrees/ starts with "{id}-"
  try {
    const entries = fs.readdirSync(worktreesDir);
    const hasWorktree = entries.some((entry) => entry.startsWith(`${item.id}-`));
    if (!hasWorktree) {
      return {
        itemId: item.id,
        title: item.title,
        state: item.state,
        issueType: 'orphaned_build',
        suggestedAction: `Move item #${item.id} back to queued — no worktree found`,
      };
    }
  } catch {
    return {
      itemId: item.id,
      title: item.title,
      state: item.state,
      issueType: 'orphaned_build',
      suggestedAction: `Move item #${item.id} back to queued — cannot read worktrees directory`,
    };
  }

  return null;
}

function checkStaleReview(item: BoardItem): RecoveryIssue | null {
  if (item.state !== 'verifying') return null;

  const updatedAt = new Date(item.updated_at).getTime();
  const age = Date.now() - updatedAt;

  if (age > STALE_THRESHOLD_MS) {
    return {
      itemId: item.id,
      title: item.title,
      state: item.state,
      issueType: 'stale_review',
      suggestedAction: `Move item #${item.id} back to queued — stuck in verifying for over 24h`,
    };
  }

  return null;
}

function checkEmptyBlockedReason(item: BoardItem): RecoveryIssue | null {
  if (item.state !== 'blocked') return null;

  if (!item.blocked_reason || item.blocked_reason.trim() === '') {
    return {
      itemId: item.id,
      title: item.title,
      state: item.state,
      issueType: 'empty_blocked_reason',
      suggestedAction: `Add a blocked_reason to item #${item.id} — blocked with no explanation`,
    };
  }

  return null;
}

function scanBoard(boardFile: board.BoardFile, cwd: string): RecoveryIssue[] {
  const issues: RecoveryIssue[] = [];

  for (const item of boardFile.items) {
    const orphaned = checkOrphanedBuild(item, cwd);
    if (orphaned) issues.push(orphaned);

    const stale = checkStaleReview(item);
    if (stale) issues.push(stale);

    const emptyBlock = checkEmptyBlockedReason(item);
    if (emptyBlock) issues.push(emptyBlock);
  }

  return issues;
}

function autoFix(
  boardFile: board.BoardFile,
  issues: RecoveryIssue[],
  dir: string,
): void {
  let modified = false;

  for (const issue of issues) {
    if (issue.issueType === 'orphaned_build' || issue.issueType === 'stale_review') {
      const item = board.getItem(boardFile, issue.itemId);
      if (item) {
        item.state = 'queued';
        item.updated_at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
        modified = true;
      }
    }
    // empty_blocked_reason is not auto-fixable — needs human decision
  }

  if (modified) {
    board.saveBoard(dir, boardFile);
  }
}

export function registerRecoverCommand(program: Command): void {
  program
    .command('recover')
    .description('Detect and report orphaned or stuck work items')
    .option('--auto', 'Automatically fix recoverable issues by moving items back to queued')
    .action((opts: { auto?: boolean }) => {
      const format = getFormat(program);
      const cwd = process.cwd();
      const dir = versoDir();
      const boardFile = board.loadBoard(dir);

      const issues = scanBoard(boardFile, cwd);

      if (opts.auto) {
        autoFix(boardFile, issues, dir);
      }

      switch (format) {
        case 'human':
          if (issues.length === 0) {
            console.log(ui.success('No issues found. Board is healthy.'));
          } else {
            console.log(ui.heading('VERSO Recover'));
            console.log();
            console.log(`Found ${issues.length} issue(s):`);
            console.log();
            for (const issue of issues) {
              const icon =
                issue.issueType === 'orphaned_build'
                  ? ui.error('ORPHAN')
                  : issue.issueType === 'stale_review'
                    ? ui.warn('STALE')
                    : ui.warn('BLOCKED');
              console.log(`  [${icon}] #${issue.itemId} ${issue.title} (${issue.state})`);
              console.log(`          ${ui.dim(issue.suggestedAction)}`);
            }
            console.log();
            if (opts.auto) {
              const fixed = issues.filter(
                (i) => i.issueType === 'orphaned_build' || i.issueType === 'stale_review',
              );
              if (fixed.length > 0) {
                console.log(ui.success(`Auto-fixed ${fixed.length} item(s) — moved back to queued.`));
              }
              const unfixed = issues.filter((i) => i.issueType === 'empty_blocked_reason');
              if (unfixed.length > 0) {
                console.log(
                  ui.warn(`${unfixed.length} issue(s) require manual intervention.`),
                );
              }
            } else {
              console.log(ui.dim('Run with --auto to automatically fix recoverable issues.'));
            }
          }
          break;

        case 'plain':
          if (issues.length === 0) {
            console.log('No issues found.');
          } else {
            for (const issue of issues) {
              console.log(
                `${issue.issueType}: #${issue.itemId} ${issue.title} (${issue.state}) — ${issue.suggestedAction}`,
              );
            }
          }
          break;

        case 'json':
          console.log(JSON.stringify(issues, null, 2));
          break;
      }
    });
}
