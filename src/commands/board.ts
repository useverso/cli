import fs from 'node:fs';
import { Command } from 'commander';

import * as board from '../core/board.js';
import { loadConfig } from '../core/config.js';
import * as stateMachine from '../core/state-machine.js';
import type { State, WorkType } from '../core/types.js';
import { ALL_STATES, ALL_WORK_TYPES } from '../core/types.js';
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

function parseState(s: string): State {
  if (ALL_STATES.includes(s as State)) return s as State;
  console.error(
    `invalid state: '${s}' (expected: ${ALL_STATES.join(', ')})`,
  );
  process.exit(1);
}

function parseWorkType(s: string): WorkType {
  if (ALL_WORK_TYPES.includes(s as WorkType)) return s as WorkType;
  console.error(
    `invalid work type: '${s}' (expected: ${ALL_WORK_TYPES.join(', ')})`,
  );
  process.exit(1);
}

export function registerBoardCommand(program: Command): void {
  const boardCmd = program
    .command('board')
    .description('Manage work items on the board');

  boardCmd
    .command('add')
    .description('Add a new work item to the board')
    .requiredOption('-t, --type <type>', 'Work type (feature, bug, hotfix, refactor, chore)')
    .requiredOption('--title <title>', 'Title of the work item')
    .option('--autonomy <level>', 'Autonomy level (1-4)', parseInt)
    .option('--description <desc>', 'Description of the work item')
    .option('--milestone <name>', 'Milestone name')
    .option('--labels <labels>', 'Comma-separated labels')
    .option('--complexity <level>', 'Complexity (simple, medium, complex)')
    .option('--spec-path <path>', 'Path to spec file')
    .action((opts: { type: string; title: string; autonomy?: number; description?: string; milestone?: string; labels?: string; complexity?: string; specPath?: string }) => {
      const format = getFormat(boardCmd);
      const dir = versoDir();
      const workType = parseWorkType(opts.type);
      const autonomy =
        opts.autonomy ?? loadConfig(dir).autonomy[workType] ?? 2;
      const boardFile = board.loadBoard(dir);
      const id = board.addItem(boardFile, workType, opts.title, autonomy, {
        description: opts.description,
        milestone: opts.milestone,
        labels: opts.labels ? opts.labels.split(',').map((s: string) => s.trim()) : undefined,
        complexity: opts.complexity as any,
        spec_path: opts.specPath,
      });
      board.saveBoard(dir, boardFile);
      const item = board.getItem(boardFile, id)!;
      output.printItemCreated(item, format);
    });

  boardCmd
    .command('show')
    .description('Show details of a work item')
    .argument('<id>', 'Item ID', parseInt)
    .action((id: number) => {
      const format = getFormat(boardCmd);
      const dir = versoDir();
      const boardFile = board.loadBoard(dir);
      const item = board.getItem(boardFile, id);
      if (!item) {
        output.printError(`item #${id} not found`, format);
        process.exit(1);
      }
      output.printItemDetail(item, format);
    });

  boardCmd
    .command('list')
    .description('List work items on the board')
    .option('--state <state>', 'Filter by state')
    .option('-t, --type <type>', 'Filter by work type')
    .action((opts: { state?: string; type?: string }) => {
      const format = getFormat(boardCmd);
      const dir = versoDir();
      const boardFile = board.loadBoard(dir);
      const state = opts.state ? parseState(opts.state) : undefined;
      const workType = opts.type ? parseWorkType(opts.type) : undefined;
      const items = board.listItems(boardFile, state, workType);
      output.printItemList(items, format);
    });

  boardCmd
    .command('move')
    .description('Move a work item to a different state')
    .argument('<id>', 'Item ID', parseInt)
    .requiredOption('--to <state>', 'Target state')
    .option('--trigger <trigger>', 'Transition trigger')
    .option('--actor <actor>', 'Actor performing the transition')
    .option('--reason <reason>', 'Reason (required when moving to blocked)')
    .action(
      (
        id: number,
        opts: { to: string; trigger?: string; actor?: string; reason?: string },
      ) => {
        const format = getFormat(boardCmd);
        const dir = versoDir();
        const boardFile = board.loadBoard(dir);
        const to = parseState(opts.to);

        if (to === 'blocked' && !opts.reason) {
          output.printError('--reason is required when moving to blocked', format);
          process.exit(1);
        }

        let trigger = opts.trigger;
        if (!trigger) {
          const item = board.getItem(boardFile, id);
          if (!item) {
            output.printError(`item #${id} not found`, format);
            process.exit(1);
          }
          trigger = stateMachine.validateTransition(item.state, to);
        }
        const actor = opts.actor ?? 'captain';

        const fromState = board.getItem(boardFile, id)!.state;
        const moveOpts = opts.reason ? { blocked_reason: opts.reason } : undefined;
        const cfg = loadConfig(dir);
        board.transitionItem(boardFile, id, to, trigger, actor, cfg, moveOpts);
        board.saveBoard(dir, boardFile);
        const item = board.getItem(boardFile, id)!;
        output.printItemMoved(item, fromState, format);
      },
    );

  boardCmd
    .command('update')
    .description('Update fields on a work item')
    .argument('<id>', 'Item ID', parseInt)
    .option('--title <title>', 'New title')
    .option('--assignee <assignee>', 'New assignee')
    .option('--description <desc>', 'New description')
    .option('--milestone <name>', 'New milestone')
    .option('--labels <labels>', 'Comma-separated labels')
    .option('--complexity <level>', 'Complexity (simple, medium, complex)')
    .option('--autonomy <level>', 'Autonomy level (1-4)', parseInt)
    .option('--branch <branch>', 'Branch name')
    .option('--pr <pr>', 'PR reference')
    .option('--blocked-reason <reason>', 'Blocked reason')
    .option('--spec-path <path>', 'Path to spec file')
    .action((id: number, opts: { title?: string; assignee?: string; description?: string; milestone?: string; labels?: string; complexity?: string; autonomy?: number; branch?: string; pr?: string; blockedReason?: string; specPath?: string }) => {
      const format = getFormat(boardCmd);
      const dir = versoDir();
      const boardFile = board.loadBoard(dir);
      const updates: board.UpdateFields = {
        title: opts.title,
        assignee: opts.assignee,
        description: opts.description,
        milestone: opts.milestone,
        labels: opts.labels ? opts.labels.split(',').map((s: string) => s.trim()) : undefined,
        complexity: opts.complexity as any,
        autonomy: opts.autonomy,
        branch: opts.branch,
        pr: opts.pr,
        blocked_reason: opts.blockedReason,
        spec_path: opts.specPath,
      };
      board.updateItem(boardFile, id, updates);
      board.saveBoard(dir, boardFile);
      const item = board.getItem(boardFile, id)!;
      output.printItemUpdated(item, format);
    });

  boardCmd
    .command('cancel')
    .description('Cancel a work item')
    .argument('<id>', 'Item ID', parseInt)
    .requiredOption('--reason <reason>', 'Reason for cancellation')
    .action((id: number, opts: { reason: string }) => {
      const format = getFormat(boardCmd);
      const dir = versoDir();
      const boardFile = board.loadBoard(dir);
      board.cancelItem(boardFile, id, opts.reason);
      board.saveBoard(dir, boardFile);
      const item = board.getItem(boardFile, id)!;
      output.printItemCancelled(item, format);
    });
}
