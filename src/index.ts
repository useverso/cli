import { Command } from 'commander';

import { registerBoardCommand } from './commands/board.js';
import { registerBuildCommand } from './commands/build.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerInitCommand } from './commands/init.js';
import { registerMetricsCommand } from './commands/metrics.js';
import { registerReviewCommand } from './commands/review.js';
import { registerShipCommand } from './commands/ship.js';
import { registerStatusCommand } from './commands/status.js';
import { registerSyncCommand } from './commands/sync.js';
import { registerUpgradeCommand } from './commands/upgrade.js';

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

program.parse();
