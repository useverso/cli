import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from '../core/config.js';
import { loadBoard, saveBoard } from '../core/board.js';
import { loadAllPlugins, applySyncActions } from '../core/plugin-loader.js';
import { createPluginContext } from '../core/plugin.js';
import type { BoardPlugin } from '../core/plugin.js';
import path from 'path';

export function registerSyncCommand(program: Command): void {
  const sync = program
    .command('sync')
    .description('Sync board state with external services')
    .action(async (opts, cmd) => {
      // Default: push then pull
      const format = cmd.parent?.opts().format || 'human';
      const versoDir = path.resolve('.verso');

      try {
        const config = loadConfig(versoDir);
        const board = loadBoard(versoDir);
        const plugins = await loadAllPlugins(config, process.cwd());

        if (!plugins.board) {
          if (format === 'json') {
            console.log(JSON.stringify({ error: 'No board plugin configured. Add plugins.board to .verso/config.yaml' }));
          } else {
            console.log(chalk.yellow('No board plugin configured.'));
            console.log('Add a board plugin to .verso/config.yaml:');
            console.log('  plugins:');
            console.log('    board: github');
          }
          return;
        }

        const ctx = createPluginContext(versoDir, config, board);
        const boardPlugin = plugins.board as BoardPlugin;

        // Push
        const pushResult = await boardPlugin.push(ctx, board.items);

        // Apply push actions (e.g., store github_issue_number)
        if (pushResult.actions.length > 0) {
          applySyncActions(board, pushResult.actions);
        }

        // Pull
        const actions = await boardPlugin.pull(ctx);
        const { applied, errors } = applySyncActions(board, actions);

        if (applied > 0 || pushResult.actions.length > 0) {
          saveBoard(versoDir, board);
        }

        if (format === 'json') {
          console.log(JSON.stringify({ pushed: pushResult.pushed, pulled: applied, errors: [...pushResult.errors, ...errors] }));
        } else {
          console.log(chalk.green(`Sync complete: ${pushResult.pushed} pushed, ${applied} pulled`));
          if (errors.length > 0) {
            errors.forEach(e => console.log(chalk.yellow(`  Warning: ${e}`)));
          }
        }
      } catch (err) {
        if (format === 'json') {
          console.log(JSON.stringify({ error: (err as Error).message }));
        } else {
          console.error(chalk.red((err as Error).message));
        }
        process.exitCode = 1;
      }
    });

  sync
    .command('push')
    .description('Push board state to external service')
    .action(async (opts, cmd) => {
      const format = cmd.parent?.parent?.opts().format || 'human';
      const versoDir = path.resolve('.verso');

      try {
        const config = loadConfig(versoDir);
        const board = loadBoard(versoDir);
        const plugins = await loadAllPlugins(config, process.cwd());

        if (!plugins.board) {
          if (format === 'json') {
            console.log(JSON.stringify({ error: 'No board plugin configured' }));
          } else {
            console.log(chalk.yellow('No board plugin configured. Add plugins.board to .verso/config.yaml'));
          }
          return;
        }

        const ctx = createPluginContext(versoDir, config, board);
        const boardPlugin = plugins.board as BoardPlugin;
        const result = await boardPlugin.push(ctx, board.items);

        // Apply push actions (e.g., store github_issue_number)
        if (result.actions.length > 0) {
          applySyncActions(board, result.actions);
          saveBoard(versoDir, board);
        }

        if (format === 'json') {
          console.log(JSON.stringify(result));
        } else {
          console.log(chalk.green(`Push complete: ${result.pushed} items synced`));
          if (result.errors.length > 0) {
            result.errors.forEach(e => console.log(chalk.yellow(`  Warning: ${e}`)));
          }
        }
      } catch (err) {
        if (format === 'json') {
          console.log(JSON.stringify({ error: (err as Error).message }));
        } else {
          console.error(chalk.red((err as Error).message));
        }
        process.exitCode = 1;
      }
    });

  sync
    .command('pull')
    .description('Pull external events into board')
    .option('--dry-run', 'Show actions without applying')
    .action(async (opts, cmd) => {
      const format = cmd.parent?.parent?.opts().format || 'human';
      const versoDir = path.resolve('.verso');
      const dryRun = opts.dryRun || false;

      try {
        const config = loadConfig(versoDir);
        const board = loadBoard(versoDir);
        const plugins = await loadAllPlugins(config, process.cwd());

        if (!plugins.board) {
          if (format === 'json') {
            console.log(JSON.stringify({ error: 'No board plugin configured' }));
          } else {
            console.log(chalk.yellow('No board plugin configured. Add plugins.board to .verso/config.yaml'));
          }
          return;
        }

        const ctx = createPluginContext(versoDir, config, board);
        const boardPlugin = plugins.board as BoardPlugin;
        const actions = await boardPlugin.pull(ctx);

        if (dryRun) {
          if (format === 'json') {
            console.log(JSON.stringify({ dryRun: true, actions }));
          } else {
            console.log(chalk.cyan(`Dry run: ${actions.length} actions would be applied`));
            actions.forEach(a => {
              if (a.type === 'move') console.log(`  Move item #${a.itemId} -> ${a.to}`);
              else if (a.type === 'update') console.log(`  Update item #${a.itemId}`);
              else if (a.type === 'add') console.log(`  Add ${a.workType}: ${a.title}`);
            });
          }
          return;
        }

        const { applied, errors } = applySyncActions(board, actions);

        if (applied > 0) {
          saveBoard(versoDir, board);
        }

        if (format === 'json') {
          console.log(JSON.stringify({ applied, errors }));
        } else {
          console.log(chalk.green(`Pull complete: ${applied} actions applied`));
          if (errors.length > 0) {
            errors.forEach(e => console.log(chalk.yellow(`  Warning: ${e}`)));
          }
        }
      } catch (err) {
        if (format === 'json') {
          console.log(JSON.stringify({ error: (err as Error).message }));
        } else {
          console.error(chalk.red((err as Error).message));
        }
        process.exitCode = 1;
      }
    });
}
