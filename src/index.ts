#!/usr/bin/env node

import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initCommand } from './commands/init.js';
import { doctorCommand } from './commands/doctor.js';
import { statusCommand } from './commands/status.js';
import { upgradeCommand } from './commands/upgrade.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from package.json
const pkg = JSON.parse(
  await readFile(join(__dirname, '..', 'package.json'), 'utf-8')
);

const program = new Command();

program
  .name('verso')
  .description('VERSO — Development framework for agentic coding')
  .version(pkg.version);

program
  .command('init')
  .description('Initialize VERSO in the current project')
  .action(initCommand);

program
  .command('doctor')
  .description('Check VERSO setup health')
  .action(doctorCommand);

program
  .command('status')
  .description('Show project status and configuration')
  .action(statusCommand);

program
  .command('upgrade')
  .description('Upgrade VERSO templates to latest version')
  .action(upgradeCommand);

program.parse();
