/**
 * Test harness for config command.
 * Wraps the main CLI and registers the config command since it's not yet in index.ts.
 */
import { Command } from 'commander';

import { registerBoardCommand } from '../../src/commands/board.js';
import { registerBuildCommand } from '../../src/commands/build.js';
import { registerConfigCommand } from '../../src/commands/config.js';
import { registerDoctorCommand } from '../../src/commands/doctor.js';
import { registerInitCommand } from '../../src/commands/init.js';
import { registerMetricsCommand } from '../../src/commands/metrics.js';
import { registerReviewCommand } from '../../src/commands/review.js';
import { registerShipCommand } from '../../src/commands/ship.js';
import { registerStatusCommand } from '../../src/commands/status.js';
import { registerSyncCommand } from '../../src/commands/sync.js';
import { registerUpgradeCommand } from '../../src/commands/upgrade.js';

const program = new Command();

program
  .name('verso')
  .version('0.1.0')
  .description('VERSO — the first development framework designed for agentic coding')
  .option('--format <format>', 'Output format: human, plain, json', 'human');

registerInitCommand(program);
registerBoardCommand(program);
registerBuildCommand(program);
registerReviewCommand(program);
registerShipCommand(program);
registerStatusCommand(program);
registerMetricsCommand(program);
registerDoctorCommand(program);
registerSyncCommand(program);
registerUpgradeCommand(program);
registerConfigCommand(program);

program.parse();
