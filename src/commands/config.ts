import fs from 'node:fs';
import { Command } from 'commander';
import yaml from 'js-yaml';

import { loadConfig } from '../core/config.js';
import type { OutputFormat } from '../output.js';

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

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function formatValue(value: unknown, key: string | undefined, format: OutputFormat): void {
  switch (format) {
    case 'json':
      console.log(JSON.stringify(value, null, 2));
      break;
    case 'plain':
      if (typeof value === 'object' && value !== null) {
        // For objects, dump as YAML
        console.log(yaml.dump(value, { lineWidth: -1, noRefs: true }).trimEnd());
      } else {
        console.log(`${key}: ${value}`);
      }
      break;
    case 'human':
      if (typeof value === 'object' && value !== null) {
        console.log(yaml.dump(value, { lineWidth: -1, noRefs: true }).trimEnd());
      } else {
        console.log(`${key}: ${value}`);
      }
      break;
  }
}

export function registerConfigCommand(program: Command): void {
  const configCmd = program
    .command('config')
    .description('Manage project configuration');

  configCmd
    .command('get [key]')
    .description('Read config values from .verso/config.yaml')
    .action((key: string | undefined) => {
      const format = getFormat(program);
      const dir = versoDir();
      const config = loadConfig(dir);

      if (!key) {
        // Dump entire config
        formatValue(config, undefined, format);
        return;
      }

      const value = getNestedValue(config as unknown as Record<string, unknown>, key);

      if (value === undefined) {
        console.error(`Config key not found: ${key}`);
        process.exit(1);
      }

      formatValue(value, key, format);
    });
}
