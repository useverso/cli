import fs from 'node:fs';
import { Command } from 'commander';

import * as board from '../core/board.js';
import { loadConfig } from '../core/config.js';
import { MaxRetriesExceededError } from '../core/error.js';
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

export function registerBuildCommand(program: Command): void {
  const buildCmd = program
    .command('build')
    .description('Build workflow commands');

  buildCmd
    .command('start')
    .description('Start building a work item')
    .argument('<id>', 'Item ID', parseInt)
    .option('--assignee <assignee>', 'Assignee for the build')
    .action((id: number, opts: { assignee?: string }) => {
      const format = getFormat(buildCmd);
      const dir = versoDir();
      const boardFile = board.loadBoard(dir);
      const cfg = loadConfig(dir);

      const existing = board.getItem(boardFile, id);
      if (!existing) {
        output.printError(`item #${id} not found`, format);
        process.exit(1);
      }
      const fromState = existing.state;

      board.transitionItem(boardFile, id, 'building', 'builder_spawned', 'pilot', cfg);

      const item = board.getItem(boardFile, id)!;
      if (opts.assignee) item.assignee = opts.assignee;
      item.agent_sessions += 1;

      board.saveBoard(dir, boardFile);
      output.printItemMoved(item, fromState, format);
    });

  buildCmd
    .command('fail')
    .description('Mark a build as failed')
    .argument('<id>', 'Item ID', parseInt)
    .requiredOption('--reason <reason>', 'Reason for failure')
    .action((id: number, opts: { reason: string }) => {
      const format = getFormat(buildCmd);
      const dir = versoDir();
      const boardFile = board.loadBoard(dir);
      const cfg = loadConfig(dir);

      const item = board.getItem(boardFile, id);
      if (!item) {
        output.printError(`item #${id} not found`, format);
        process.exit(1);
      }
      const fromState = item.state;

      try {
        board.transitionItem(boardFile, id, 'queued', 'build_failed', 'pilot', cfg);
        board.getItem(boardFile, id)!.retries += 1;
      } catch (err) {
        if (err instanceof MaxRetriesExceededError) {
          const maxRetries = cfg.build.max_retries;
          board.moveItem(boardFile, id, 'blocked', 'max_retries_exceeded', 'pilot', {
            blocked_reason: `Max retries exceeded (${item.retries}/${maxRetries}): ${opts.reason}`,
          });
        } else {
          throw err;
        }
      }

      board.saveBoard(dir, boardFile);
      const updated = board.getItem(boardFile, id)!;
      output.printItemMoved(updated, fromState, format);
    });
}
