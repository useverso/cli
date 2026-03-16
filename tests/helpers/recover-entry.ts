/**
 * Test entry point that registers the recover command.
 * Used by recover.test.ts since recover is not yet registered in src/index.ts.
 */
import { Command } from 'commander';

import { registerRecoverCommand } from '../../src/commands/recover.js';

const program = new Command();

program
  .name('verso')
  .version('0.1.0')
  .description('VERSO test harness for recover command')
  .option('--format <format>', 'Output format: human, plain, json', 'human');

registerRecoverCommand(program);

program.parse();
