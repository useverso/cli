import { existsSync } from 'node:fs';
import { copyFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

import type { VersoConfig, State, DoctorCheck } from '../../types/index.js';
import type { BoardIntegration, BoardItem } from './interface.js';
import { getTemplatesDir } from '../templates.js';
import { VERSO_DIR } from '../../constants.js';

const BOARD_FILE = 'board.yaml';

export class LocalIntegration implements BoardIntegration {
  name = 'local';

  /**
   * Copy the board.yaml template into the project's .verso/ directory
   * if it does not already exist.
   */
  async setup(projectRoot: string, _config: VersoConfig): Promise<void> {
    const dest = join(projectRoot, VERSO_DIR, BOARD_FILE);

    if (existsSync(dest)) {
      return; // already exists, nothing to do
    }

    const templatesDir = getTemplatesDir();
    const src = join(templatesDir, VERSO_DIR, BOARD_FILE);
    await copyFile(src, dest);
  }

  /**
   * Check that .verso/board.yaml exists and is valid YAML.
   */
  async validate(projectRoot: string, _config: VersoConfig): Promise<DoctorCheck[]> {
    const results: DoctorCheck[] = [];
    const boardPath = join(projectRoot, VERSO_DIR, BOARD_FILE);

    if (!existsSync(boardPath)) {
      results.push({
        name: 'board.yaml exists',
        severity: 'fail',
        message: `${VERSO_DIR}/${BOARD_FILE} not found. Run \`verso init\` to create it.`,
      });
      return results;
    }

    results.push({
      name: 'board.yaml exists',
      severity: 'pass',
      message: `${VERSO_DIR}/${BOARD_FILE} found`,
    });

    // Attempt to parse the YAML
    try {
      const raw = await readFile(boardPath, 'utf-8');
      const parsed = parseYaml(raw);

      if (parsed == null || typeof parsed !== 'object') {
        results.push({
          name: 'board.yaml valid YAML',
          severity: 'fail',
          message: `${VERSO_DIR}/${BOARD_FILE} does not contain a valid YAML mapping`,
        });
      } else {
        results.push({
          name: 'board.yaml valid YAML',
          severity: 'pass',
          message: `${VERSO_DIR}/${BOARD_FILE} parses correctly`,
        });
      }
    } catch (err) {
      results.push({
        name: 'board.yaml valid YAML',
        severity: 'fail',
        message: `${VERSO_DIR}/${BOARD_FILE} parse error: ${(err as Error).message}`,
      });
    }

    return results;
  }

  /**
   * Local board is the source of truth -- return items unchanged.
   */
  async sync(_projectRoot: string, board: BoardItem[]): Promise<BoardItem[]> {
    return board;
  }

  /**
   * Read board.yaml and return item counts grouped by state.
   */
  getStatusInfo(config: VersoConfig): Record<string, string> {
    // We cannot do async I/O here, so return static info.
    // The actual board stats can be computed by the caller after reading the board.
    const info: Record<string, string> = {
      provider: 'local',
      path: config.board.local?.path ?? `${VERSO_DIR}/${BOARD_FILE}`,
    };
    return info;
  }
}
