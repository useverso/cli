import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';

import * as board from '../core/board.js';
import { ItemNotFoundError } from '../core/error.js';
import { getTemplate } from '../templates.js';
import type { OutputFormat } from '../output.js';
import { printError } from '../output.js';
import * as ui from '../ui.js';

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

/**
 * Convert a title to a URL-friendly slug.
 * Lowercase, spaces to hyphens, strip non-alphanumeric, collapse hyphens.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface CreateSpecResult {
  id: number;
  title: string;
  spec_path: string;
}

/**
 * Create a spec file for a board item.
 * Exported for direct use in unit tests.
 */
export function createSpec(
  versoDir: string,
  id: number,
  force: boolean,
): CreateSpecResult {
  const boardFile = board.loadBoard(versoDir);
  const item = board.getItem(boardFile, id);

  if (!item) {
    throw new ItemNotFoundError(id);
  }

  if (item.spec_path && !force) {
    throw new Error(
      `Item #${id} already has a spec at '${item.spec_path}'. Use --force to overwrite.`,
    );
  }

  const slug = slugify(item.title);
  const specRelPath = `.verso/specs/${id}-${slug}.md`;
  const specsDir = path.join(versoDir, 'specs');
  const projectDir = path.dirname(versoDir);
  const specAbsPath = path.join(projectDir, specRelPath);

  // Load spec template and replace placeholder
  const template = getTemplate('templates/spec.md') ?? '# Spec: {Feature Title}\n';
  const content = template.replace('{Feature Title}', item.title);

  // Create specs directory if needed
  fs.mkdirSync(specsDir, { recursive: true });

  // Write spec file
  fs.writeFileSync(specAbsPath, content, 'utf-8');

  // Update board item
  board.updateItem(boardFile, id, { spec_path: specRelPath });
  board.saveBoard(versoDir, boardFile);

  return {
    id: item.id,
    title: item.title,
    spec_path: specRelPath,
  };
}

export function registerSpecCommand(program: Command): void {
  const spec = program
    .command('spec')
    .description('Manage specs for board items');

  spec
    .command('create <id>')
    .description('Create a spec file for a board item')
    .option('--force', 'Overwrite existing spec', false)
    .action((idStr: string, opts: { force: boolean }) => {
      const format = getFormat(program);
      const dir = versoDir();
      const id = Number.parseInt(idStr, 10);

      if (Number.isNaN(id)) {
        printError('Invalid item id', format);
        process.exit(1);
      }

      try {
        const result = createSpec(dir, id, opts.force);

        switch (format) {
          case 'human':
            console.log(
              `${ui.success('Created')} spec for #${result.id} ${result.title}`,
            );
            console.log(`  ${ui.dim('Path:')} ${result.spec_path}`);
            break;
          case 'plain':
            console.log(`id: ${result.id}`);
            console.log(`title: ${result.title}`);
            console.log(`spec_path: ${result.spec_path}`);
            break;
          case 'json':
            console.log(JSON.stringify(result, null, 2));
            break;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        printError(msg, format);
        process.exit(1);
      }
    });
}
