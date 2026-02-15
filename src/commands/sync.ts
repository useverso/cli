import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';

import type { VersoConfig } from '../types/index.js';
import { VERSO_DIR } from '../constants.js';
import { ui, VersoError, handleError } from '../lib/ui.js';
import { getIntegration } from '../lib/integrations/registry.js';
import type { BoardItem } from '../lib/integrations/interface.js';

const BOARD_FILE = 'board.yaml';

interface BoardFile {
  items: BoardItem[];
}

export async function syncCommand(): Promise<void> {
  try {
    const projectRoot = process.cwd();

    // Preflight: .verso/ must exist
    if (!existsSync(join(projectRoot, VERSO_DIR))) {
      throw new VersoError('.verso/ not found. Run `verso init` first.');
    }

    ui.heading('VERSO Sync');

    // Read config
    const configPath = join(projectRoot, VERSO_DIR, 'config.yaml');
    let config: VersoConfig;

    try {
      const raw = await readFile(configPath, 'utf-8');
      config = parse(raw) as VersoConfig;
    } catch {
      throw new VersoError('Could not parse .verso/config.yaml');
    }

    const provider = config.board?.provider;
    if (!provider) {
      throw new VersoError('board.provider is not set in config.yaml');
    }

    if (provider === 'local') {
      ui.info('Board provider is local — nothing to sync.');
      return;
    }

    // Read board.yaml
    const boardPath = join(projectRoot, VERSO_DIR, BOARD_FILE);

    if (!existsSync(boardPath)) {
      throw new VersoError(
        `.verso/${BOARD_FILE} not found. Run \`verso init\` to create it.`
      );
    }

    let boardData: BoardFile;

    try {
      const raw = await readFile(boardPath, 'utf-8');
      const parsed = parse(raw) as BoardFile | null;
      boardData = { items: parsed?.items ?? [] };
    } catch {
      throw new VersoError('Could not parse .verso/board.yaml');
    }

    // Resolve integration and sync
    const integration = getIntegration(provider);
    const spinner = ui.spinner(`Syncing with ${integration.name}...`);

    try {
      const updatedBoard = await integration.sync(projectRoot, boardData.items);

      // Write synced board back to disk
      boardData.items = updatedBoard;
      await writeFile(boardPath, stringify(boardData), 'utf-8');

      const itemCount = updatedBoard.length;
      spinner.succeed(`  Synced ${itemCount} item${itemCount !== 1 ? 's' : ''} with ${integration.name}`);
    } catch (error) {
      spinner.fail('  Sync failed');
      throw new VersoError(
        `Could not sync with ${provider}: ${error instanceof Error ? error.message : error}`
      );
    }

    ui.blank();
  } catch (error) {
    handleError(error);
  }
}
