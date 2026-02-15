import { existsSync } from 'node:fs';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import type { VersoConfig, DoctorCheck } from '../../types/index.js';
import type { BoardIntegration, BoardItem } from './interface.js';
import { getTemplatesDir } from '../templates.js';
import { VERSO_DIR } from '../../constants.js';
import {
  isGhAvailable,
  isGhAuthenticated,
  hasProjectScope,
  getRepoSlug,
} from '../github.js';

const execFile = promisify(execFileCb);

const BOARD_FILE = 'board.yaml';

// ----- Board file helpers ----------------------------------------------------

interface BoardFile {
  items: BoardItem[];
}

async function writeBoard(projectRoot: string, board: BoardFile): Promise<void> {
  const boardPath = join(projectRoot, VERSO_DIR, BOARD_FILE);
  const header = [
    '# VERSO Local Board',
    '# This is the local source of truth for work items.',
    '# Sync with external providers (GitHub, Linear) via `verso sync`.',
    '',
  ].join('\n');
  const yaml = stringifyYaml(board, { lineWidth: 120 });
  await writeFile(boardPath, `${header}\n${yaml}`, 'utf-8');
}

// ----- GitHub issue helpers --------------------------------------------------

interface GitHubIssue {
  number: number;
  title: string;
  state: string; // OPEN | CLOSED
  labels: Array<{ name: string }>;
}

/**
 * Create a GitHub issue and return its number.
 */
async function createIssue(
  cwd: string,
  title: string,
  labels: string[],
): Promise<number | null> {
  try {
    const args = ['issue', 'create', '--title', title, '--body', ''];
    for (const label of labels) {
      args.push('--label', label);
    }
    args.push('--json', 'number', '-q', '.number');
    const { stdout } = await execFile('gh', args, { cwd });
    const num = parseInt(stdout.trim(), 10);
    return Number.isNaN(num) ? null : num;
  } catch {
    return null;
  }
}

/**
 * Get a single issue by number.
 */
async function getIssue(cwd: string, issueNumber: number): Promise<GitHubIssue | null> {
  try {
    const { stdout } = await execFile('gh', [
      'issue', 'view', String(issueNumber),
      '--json', 'number,title,state,labels',
    ], { cwd });
    return JSON.parse(stdout) as GitHubIssue;
  } catch {
    return null;
  }
}

// =============================================================================
// GitHubIntegration
// =============================================================================

export class GitHubIntegration implements BoardIntegration {
  name = 'github';

  // ---------------------------------------------------------------------------
  // setup — called during `verso init`
  // ---------------------------------------------------------------------------

  /**
   * Copy the board.yaml template into the project's .verso/ directory
   * if it does not already exist (same as local), since board.yaml is the
   * local source of truth even when using GitHub as the board provider.
   */
  async setup(projectRoot: string, _config: VersoConfig): Promise<void> {
    const dest = join(projectRoot, VERSO_DIR, BOARD_FILE);

    if (existsSync(dest)) {
      return;
    }

    const templatesDir = getTemplatesDir();
    const src = join(templatesDir, VERSO_DIR, BOARD_FILE);
    await copyFile(src, dest);
  }

  // ---------------------------------------------------------------------------
  // validate — called during `verso doctor`
  // ---------------------------------------------------------------------------

  async validate(projectRoot: string, config: VersoConfig): Promise<DoctorCheck[]> {
    const checks: DoctorCheck[] = [];

    // 1. board.yaml exists and is valid
    const boardPath = join(projectRoot, VERSO_DIR, BOARD_FILE);

    if (!existsSync(boardPath)) {
      checks.push({
        name: 'board.yaml exists',
        severity: 'fail',
        message: `${VERSO_DIR}/${BOARD_FILE} not found. Run \`verso init\` to create it.`,
      });
    } else {
      checks.push({
        name: 'board.yaml exists',
        severity: 'pass',
        message: `${VERSO_DIR}/${BOARD_FILE} found`,
      });

      try {
        const raw = await readFile(boardPath, 'utf-8');
        const parsed = parseYaml(raw);
        if (parsed == null || typeof parsed !== 'object') {
          checks.push({
            name: 'board.yaml valid YAML',
            severity: 'fail',
            message: `${VERSO_DIR}/${BOARD_FILE} does not contain a valid YAML mapping`,
          });
        } else {
          checks.push({
            name: 'board.yaml valid YAML',
            severity: 'pass',
            message: `${VERSO_DIR}/${BOARD_FILE} parses correctly`,
          });
        }
      } catch (err) {
        checks.push({
          name: 'board.yaml valid YAML',
          severity: 'fail',
          message: `${VERSO_DIR}/${BOARD_FILE} parse error: ${(err as Error).message}`,
        });
      }
    }

    // 2. gh CLI available
    const ghAvailable = await isGhAvailable();

    if (!ghAvailable) {
      checks.push({
        name: 'gh CLI installed',
        severity: 'fail',
        message: 'gh CLI is not installed (https://cli.github.com)',
      });
      return checks; // Cannot proceed without gh
    }

    checks.push({
      name: 'gh CLI installed',
      severity: 'pass',
      message: 'gh CLI is installed',
    });

    // 3. gh authenticated
    const ghAuthed = await isGhAuthenticated();

    if (!ghAuthed) {
      checks.push({
        name: 'gh CLI authenticated',
        severity: 'fail',
        message: 'gh CLI is not authenticated (run `gh auth login`)',
      });
      return checks;
    }

    checks.push({
      name: 'gh CLI authenticated',
      severity: 'pass',
      message: 'gh CLI is authenticated',
    });

    // 4. project scope
    const projectScope = await hasProjectScope();

    if (!projectScope) {
      checks.push({
        name: 'gh project scope',
        severity: 'warn',
        message: "Missing 'project' scope — run `gh auth refresh -s project` for full board integration",
      });
    } else {
      checks.push({
        name: 'gh project scope',
        severity: 'pass',
        message: "'project' scope present",
      });
    }

    // 5. GitHub repo accessible
    const repoSlug = await getRepoSlug(projectRoot);

    if (!repoSlug) {
      checks.push({
        name: 'GitHub repo',
        severity: 'warn',
        message: 'No GitHub remote found — issue sync will not work',
      });
    } else {
      checks.push({
        name: 'GitHub repo',
        severity: 'pass',
        message: `GitHub repo: ${repoSlug}`,
      });
    }

    // 6. Project number configured
    const projectNumber = config.board.github?.project_number;
    const projectOwner = config.board.github?.owner;

    if (!projectNumber || !projectOwner) {
      checks.push({
        name: 'GitHub Project configured',
        severity: 'warn',
        message: 'board.github.owner / project_number not set in config.yaml — project board features unavailable',
      });
    } else {
      checks.push({
        name: 'GitHub Project configured',
        severity: 'pass',
        message: `GitHub Project: ${projectOwner} #${projectNumber}`,
      });
    }

    return checks;
  }

  // ---------------------------------------------------------------------------
  // sync — bidirectional sync between board.yaml and GitHub Issues/Projects
  // ---------------------------------------------------------------------------

  /**
   * Bidirectional sync:
   *   Push: create GitHub issues for local items without a github_issue external ref.
   *   Pull: update local item state from GitHub issue status for items WITH a github_issue ref.
   *   Conflict resolution: local wins (local is source of truth).
   */
  async sync(projectRoot: string, board: BoardItem[]): Promise<BoardItem[]> {
    const repoSlug = await getRepoSlug(projectRoot);
    if (!repoSlug) {
      // No GitHub remote — return board unchanged
      return board;
    }

    const updatedBoard = [...board.map(item => ({ ...item, external: { ...item.external } }))];

    // --- Push: create issues for items without github_issue ---
    for (const item of updatedBoard) {
      const ghIssueNum = item.external?.github_issue as number | undefined;

      if (!ghIssueNum) {
        // No GitHub issue yet — create one
        const labels = item.labels.length > 0 ? item.labels : [item.type];
        const issueNumber = await createIssue(projectRoot, item.title, labels);

        if (issueNumber) {
          item.external.github_issue = issueNumber;
          item.updated_at = new Date().toISOString();
        }
      }
    }

    // --- Pull: update local items from their linked GitHub issues ---
    for (const item of updatedBoard) {
      const ghIssueNum = item.external?.github_issue as number | undefined;

      if (!ghIssueNum) {
        continue; // No linked issue — skip
      }

      const issue = await getIssue(projectRoot, ghIssueNum);
      if (!issue) {
        continue; // Issue not found — skip
      }

      // Sync state from GitHub issue status:
      //   CLOSED -> done (unless local already says cancelled)
      //   OPEN -> keep local state (local wins for open items)
      if (issue.state === 'CLOSED' && item.state !== 'done' && item.state !== 'cancelled') {
        item.state = 'done';
        item.updated_at = new Date().toISOString();
      }

      // Update title from GitHub if it was changed there and local hasn't diverged
      // (skip — local wins per spec)
    }

    // Persist the updated board back to board.yaml
    await writeBoard(projectRoot, { items: updatedBoard });

    return updatedBoard;
  }

  // ---------------------------------------------------------------------------
  // getStatusInfo — provider-specific status for `verso status`
  // ---------------------------------------------------------------------------

  getStatusInfo(config: VersoConfig): Record<string, string> {
    const info: Record<string, string> = {
      provider: 'github',
    };

    const ghConfig = config.board.github;
    if (ghConfig) {
      if (ghConfig.owner) {
        info.owner = ghConfig.owner;
      }
      if (ghConfig.project_number) {
        info.project_number = String(ghConfig.project_number);
        if (ghConfig.owner) {
          info.project_url = `https://github.com/orgs/${ghConfig.owner}/projects/${ghConfig.project_number}`;
        }
      }
    }

    return info;
  }
}
