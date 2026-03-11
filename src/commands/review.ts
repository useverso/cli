import fs from 'node:fs';
import { Command } from 'commander';

import * as board from '../core/board.js';
import { loadConfig } from '../core/config.js';
import { loadAllPlugins } from '../core/plugin-loader.js';
import { createPluginContext } from '../core/plugin.js';
import type { CiPlugin, ReviewPlugin } from '../core/plugin.js';
import * as stateMachine from '../core/state-machine.js';
import type { Review } from '../core/types.js';
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

export function registerReviewCommand(program: Command): void {
  const reviewCmd = program
    .command('review')
    .description('Review workflow commands');

  reviewCmd
    .command('start')
    .description('Start reviewing a work item')
    .argument('<id>', 'Item ID', parseInt)
    .action(async (id: number) => {
      const format = getFormat(reviewCmd);
      const dir = versoDir();
      const boardFile = board.loadBoard(dir);

      const item = board.getItem(boardFile, id);
      if (!item) {
        output.printError(`item #${id} not found`, format);
        process.exit(1);
      }
      const fromState = item.state;

      const cfg = loadConfig(dir);

      // CI guard: block transition if CI checks fail
      const plugins = await loadAllPlugins(cfg, process.cwd());
      const ciPlugin = plugins.ci ? (plugins.ci as CiPlugin) : null;
      await stateMachine.checkCiGuard(item.branch || '', cfg, ciPlugin, { itemId: id });

      board.transitionItem(boardFile, id, 'verifying', 'pr_created', 'pilot', cfg);
      board.saveBoard(dir, boardFile);

      // Notify review plugin if available (informational only)
      try {
        if (plugins.review) {
          const reviewPlugin = plugins.review as ReviewPlugin;
          const ctx = createPluginContext(dir, cfg, boardFile);
          await reviewPlugin.onPrCreated(ctx, {
            itemId: id,
            title: item.title,
            branch: item.branch || '',
          });
        }
      } catch {
        // Plugin failure is informational — don't block the command
      }

      const updated = board.getItem(boardFile, id)!;
      output.printItemMoved(updated, fromState, format);
    });

  reviewCmd
    .command('submit')
    .description('Submit a review verdict')
    .argument('<id>', 'Item ID', parseInt)
    .requiredOption('--verdict <verdict>', 'Review verdict (approve, request-changes)')
    .requiredOption('--summary <summary>', 'Review summary')
    .action((id: number, opts: { verdict: string; summary: string }) => {
      const format = getFormat(reviewCmd);
      const dir = versoDir();
      const boardFile = board.loadBoard(dir);
      const cfg = loadConfig(dir);

      const item = board.getItem(boardFile, id);
      if (!item) {
        output.printError(`item #${id} not found`, format);
        process.exit(1);
      }
      const fromState = item.state;

      switch (opts.verdict) {
        case 'approve':
          board.transitionItem(boardFile, id, 'pr_ready', 'reviewer_commented', 'reviewer', cfg);
          break;
        case 'request-changes':
          board.transitionItem(boardFile, id, 'building', 'issues_found', 'reviewer', cfg);
          break;
        default:
          output.printError(
            `invalid verdict: '${opts.verdict}' (expected: approve, request-changes)`,
            format,
          );
          process.exit(1);
      }

      const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
      const updatedItem = board.getItem(boardFile, id)!;
      const review: Review = {
        verdict: opts.verdict,
        criteria_met: '',
        summary: opts.summary,
        issues: [],
        at: now,
      };
      updatedItem.reviews.push(review);

      board.saveBoard(dir, boardFile);
      output.printItemMoved(updatedItem, fromState, format);
    });

  reviewCmd
    .command('escalate')
    .description('Escalate a review to a human')
    .argument('<id>', 'Item ID', parseInt)
    .action((id: number) => {
      const format = getFormat(reviewCmd);
      const dir = versoDir();
      const boardFile = board.loadBoard(dir);

      const item = board.getItem(boardFile, id);
      if (!item) {
        output.printError(`item #${id} not found`, format);
        process.exit(1);
      }
      const fromState = item.state;

      const cfg = loadConfig(dir);
      board.transitionItem(boardFile, id, 'blocked', 'blocked_by_external', 'reviewer', cfg, { blocked_reason: 'review rejected' });
      board.saveBoard(dir, boardFile);

      const updated = board.getItem(boardFile, id)!;
      output.printItemMoved(updated, fromState, format);
    });
}
