import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

const VERSO_TEMPLATE_PROJECT_NUMBER = 4;
const VERSO_TEMPLATE_OWNER = 'useverso';

/** Result of a GitHub Project creation attempt. */
export interface GitHubProjectResult {
  url: string | null;
  number: number | null;
  error: string | null;
}

/**
 * Check if the `gh` CLI is installed and available in PATH.
 */
export async function isGhAvailable(): Promise<boolean> {
  try {
    await execFile('gh', ['--version']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if the user is authenticated with `gh`.
 */
export async function isGhAuthenticated(): Promise<boolean> {
  try {
    await execFile('gh', ['auth', 'status']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if the current `gh` token has the `project` scope.
 * GitHub Projects v2 API requires this scope explicitly.
 */
export async function hasProjectScope(): Promise<boolean> {
  try {
    const { stdout } = await execFile('gh', ['auth', 'status']);
    return stdout.includes("'project'") || stdout.includes('"project"');
  } catch {
    return false;
  }
}

/**
 * Get the GitHub repository slug (owner/repo) for the current directory.
 */
export async function getRepoSlug(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFile('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], { cwd });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Get the user's GitHub organizations.
 */
export async function getGitHubOrgs(): Promise<string[]> {
  try {
    const { stdout } = await execFile('gh', [
      'api', 'user/orgs', '--jq', '.[].login',
    ]);
    return stdout.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/** Result of a GitHub repository creation attempt. */
export interface GitHubRepoResult {
  url: string | null;
  error: string | null;
}

/**
 * Create a new GitHub repository and set it as remote origin.
 * Uses `gh repo create` with --private --source --push flags.
 * @param name - repo name (e.g., "my-project" for personal, or "org/my-project" for org)
 * @param cwd - working directory (must have at least one commit)
 */
export async function createGitHubRepo(name: string, cwd: string): Promise<GitHubRepoResult> {
  try {
    const { stdout } = await execFile('gh', [
      'repo', 'create', name,
      '--private',
      '--source', '.',
      '--push',
    ], { cwd });

    // gh repo create outputs the URL of the created repo
    const urlMatch = stdout.match(/(https:\/\/github\.com\/\S+)/);
    return { url: urlMatch ? urlMatch[1] : stdout.trim() || null, error: null };
  } catch (error) {
    const err = error as { stderr?: string; message?: string };
    return { url: null, error: err.stderr || err.message || 'Unknown error' };
  }
}

/**
 * Copy the VERSO template project to the target owner.
 * Uses `gh project copy` to clone the pre-configured template
 * with all Status fields, views, and custom fields.
 */
export async function copyVersoProject(
  title: string,
  targetOwner: string,
): Promise<GitHubProjectResult> {
  try {
    const { stdout } = await execFile('gh', [
      'project', 'copy',
      String(VERSO_TEMPLATE_PROJECT_NUMBER),
      '--source-owner', VERSO_TEMPLATE_OWNER,
      '--target-owner', targetOwner,
      '--title', title,
      '--format', 'json',
    ]);

    const result = JSON.parse(stdout);
    const url = result.url || null;
    const number = result.number || null;
    return { url, number, error: null };
  } catch (error) {
    const err = error as { stderr?: string; message?: string };
    const stderr = err.stderr?.trim() ?? '';
    const message = err.message ?? 'Unknown error';
    return { url: null, number: null, error: stderr || message };
  }
}
