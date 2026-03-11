import fs from 'node:fs';
import { Command } from 'commander';

import * as board from '../core/board.js';
import { loadConfig } from '../core/config.js';
import { loadAllPlugins } from '../core/plugin-loader.js';
import { createPluginContext } from '../core/plugin.js';
import type { CiPlugin, ReviewPlugin } from '../core/plugin.js';
import * as stateMachine from '../core/state-machine.js';
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

export function registerShipCommand(program: Command): void {
  program
    .command('ship')
    .description('Ship a work item (mark PR as merged)')
    .argument('<id>', 'Item ID', parseInt)
    .action(async (id: number) => {
      const format = getFormat(program);
      const dir = versoDir();
      const boardFile = board.loadBoard(dir);

      const item = board.getItem(boardFile, id);
      if (!item) {
        output.printError(`item #${id} not found`, format);
        process.exit(1);
      }
      const fromState = item.state;

      const cfg = loadConfig(dir);
      const plugins = await loadAllPlugins(cfg, process.cwd());

      // CI guard: block transition if CI checks fail
      const ciPlugin = plugins.ci ? (plugins.ci as CiPlugin) : null;
      await stateMachine.checkCiGuard(item.branch || '', cfg, ciPlugin, { itemId: id });

      // Try to merge PR via review plugin if available
      try {
        if (plugins.review && item.pr) {
          const reviewPlugin = plugins.review as ReviewPlugin;
          const ctx = createPluginContext(dir, cfg, boardFile);
          const mergeResult = await reviewPlugin.mergePr(ctx, item.pr);
          if (!mergeResult.merged) {
            output.printError(
              `PR merge blocked: ${mergeResult.error || 'unknown error'}`,
              format,
            );
            process.exit(1);
          }
        }
      } catch {
        // Plugin failure — warn but allow transition
        console.warn('Warning: review plugin failed, proceeding with ship');
      }

      board.transitionItem(boardFile, id, 'done', 'pr_merged', 'captain', cfg);
      board.saveBoard(dir, boardFile);

      const updated = board.getItem(boardFile, id)!;
      output.printItemMoved(updated, fromState, format);
    });
}
