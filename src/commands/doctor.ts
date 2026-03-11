import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';

import * as boardMod from '../core/board.js';
import { loadConfig } from '../core/config.js';
import { loadAllPlugins } from '../core/plugin-loader.js';
import { createPluginContext } from '../core/plugin.js';
import * as schema from '../core/schema.js';
import type { DoctorCheck } from '../core/types.js';
import type { OutputFormat } from '../output.js';
import * as ui from '../ui.js';

function getFormat(cmd: Command): OutputFormat {
  return cmd.optsWithGlobals().format ?? 'human';
}

function checkDirExists(versoDir: string): DoctorCheck {
  return fs.existsSync(versoDir)
    ? { name: 'verso_dir', severity: 'pass', message: '.verso/ directory exists' }
    : { name: 'verso_dir', severity: 'fail', message: '.verso/ directory not found' };
}

function checkFileExists(versoDir: string, filename: string, required: boolean): DoctorCheck {
  const filePath = path.join(versoDir, filename);
  const name = filename.replace(/[/.]/g, '_');
  return fs.existsSync(filePath)
    ? { name, severity: 'pass', message: `${filename} exists` }
    : { name, severity: required ? 'fail' : 'warn', message: `${filename} not found` };
}

function checkYamlValid(versoDir: string, filename: string): DoctorCheck {
  const filePath = path.join(versoDir, filename);
  const name = `${filename.replace(/[/.]/g, '_')}_valid`;
  if (!fs.existsSync(filePath)) {
    return { name, severity: 'fail', message: `${filename} not found, cannot validate` };
  }
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    schema.detectSchemaVersion(content);
    return { name, severity: 'pass', message: `${filename} is valid YAML` };
  } catch {
    return { name, severity: 'fail', message: `${filename} has invalid YAML` };
  }
}

function checkSchemaVersion(versoDir: string, filename: string): DoctorCheck {
  const filePath = path.join(versoDir, filename);
  const name = `${filename.replace(/[/.]/g, '_')}_schema`;
  if (!fs.existsSync(filePath)) {
    return { name, severity: 'fail', message: `${filename} not found` };
  }
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const v = schema.detectSchemaVersion(content);
    if (v > 0) {
      return { name, severity: 'pass', message: `${filename} has schema_version ${v}` };
    }
    return { name, severity: 'warn', message: `${filename} missing schema_version field` };
  } catch {
    return { name, severity: 'fail', message: `${filename} cannot parse schema_version` };
  }
}

function checkBoardItemsValid(versoDir: string): DoctorCheck {
  try {
    const boardFile = boardMod.loadBoard(versoDir);
    const count = boardFile.items.length;
    return {
      name: 'board_items_valid',
      severity: 'pass',
      message: `all ${count} board items have valid states and types`,
    };
  } catch (e) {
    return {
      name: 'board_items_valid',
      severity: 'fail',
      message: `cannot load board to validate items: ${e}`,
    };
  }
}

function checkWipNotExceeded(versoDir: string): DoctorCheck {
  let boardFile;
  try {
    boardFile = boardMod.loadBoard(versoDir);
  } catch {
    return { name: 'wip_limits', severity: 'fail', message: 'cannot load board to check WIP' };
  }

  let cfg;
  try {
    cfg = loadConfig(versoDir);
  } catch {
    return {
      name: 'wip_limits',
      severity: 'warn',
      message: 'cannot load config to check WIP limits',
    };
  }

  const building = boardMod.countInState(boardFile, 'building');
  if (building > cfg.wip.building) {
    return {
      name: 'wip_limits',
      severity: 'warn',
      message: `building WIP exceeded: ${building} items (limit: ${cfg.wip.building})`,
    };
  }
  return {
    name: 'wip_limits',
    severity: 'pass',
    message: `WIP within limits (building: ${building}/${cfg.wip.building})`,
  };
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Validate .verso configuration and board health')
    .action(async () => {
      const format = getFormat(program);
      const cwd = process.cwd();
      const versoDir = path.join(cwd, '.verso');

      const checks: DoctorCheck[] = [];

      checks.push(checkDirExists(versoDir));

      if (fs.existsSync(versoDir)) {
        checks.push(checkFileExists(versoDir, 'config.yaml', true));
        checks.push(checkYamlValid(versoDir, 'config.yaml'));
        checks.push(checkFileExists(versoDir, 'board.yaml', true));
        checks.push(checkYamlValid(versoDir, 'board.yaml'));

        checks.push(checkFileExists(versoDir, 'state-machine.yaml', false));
        checks.push(checkFileExists(versoDir, 'roadmap.yaml', false));
        checks.push(checkFileExists(versoDir, 'releases.yaml', false));

        checks.push(checkSchemaVersion(versoDir, 'config.yaml'));
        checks.push(checkSchemaVersion(versoDir, 'board.yaml'));

        checks.push(checkFileExists(versoDir, 'agents/pilot.md', false));

        const templatesDir = path.join(versoDir, 'templates');
        checks.push(
          fs.existsSync(templatesDir)
            ? { name: 'templates_dir', severity: 'pass', message: 'templates/ directory exists' }
            : { name: 'templates_dir', severity: 'warn', message: 'templates/ directory not found' },
        );

        checks.push(checkBoardItemsValid(versoDir));
        checks.push(checkWipNotExceeded(versoDir));

        // Plugin validation checks
        try {
          const cfg = loadConfig(versoDir);
          const plugins = await loadAllPlugins(cfg, cwd);
          const boardFile = boardMod.loadBoard(versoDir);
          const ctx = createPluginContext(versoDir, cfg, boardFile);

          for (const plugin of Object.values(plugins)) {
            if (plugin && typeof plugin.validate === 'function') {
              try {
                const pluginChecks = await plugin.validate(ctx);
                for (const pc of pluginChecks) {
                  checks.push({
                    name: `plugin_${plugin.meta.name}_${pc.name}`,
                    severity: pc.passed ? 'pass' : 'warn',
                    message: pc.message,
                  });
                }
              } catch (err) {
                checks.push({
                  name: `plugin_${plugin.meta.name}_error`,
                  severity: 'warn',
                  message: `Plugin ${plugin.meta.name} validate failed: ${(err as Error).message}`,
                });
              }
            }
          }
        } catch {
          // Plugin loading failed — add warning but don't crash
          checks.push({
            name: 'plugins',
            severity: 'warn',
            message: 'Could not load plugins for validation',
          });
        }
      }

      const hasFail = checks.some((c) => c.severity === 'fail');
      const hasWarn = checks.some((c) => c.severity === 'warn');

      switch (format) {
        case 'human':
          console.log(ui.heading('VERSO Doctor'));
          console.log();
          for (const check of checks) {
            const indicator =
              check.severity === 'pass'
                ? ui.success('PASS')
                : check.severity === 'warn'
                  ? ui.warn('WARN')
                  : ui.error('FAIL');
            console.log(`  [${indicator}] ${check.message}`);
          }
          console.log();
          if (hasFail) {
            console.log(ui.error('Some checks failed.'));
          } else if (hasWarn) {
            console.log(ui.warn('All critical checks passed, but there are warnings.'));
          } else {
            console.log(ui.success('All checks passed!'));
          }
          break;
        case 'plain':
          for (const check of checks) {
            console.log(`${check.name}: ${check.severity} - ${check.message}`);
          }
          break;
        case 'json':
          console.log(
            JSON.stringify(
              { checks, has_failures: hasFail, has_warnings: hasWarn },
              null,
              2,
            ),
          );
          break;
      }

      if (hasFail) process.exit(1);
    });
}
