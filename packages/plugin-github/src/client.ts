import { Octokit } from '@octokit/rest';
import { execSync } from 'node:child_process';

export interface GitHubConfig {
  owner: string;
  repo: string;
  token_env: string;
  base_branch: string;
}

/**
 * Resolve GitHub token from environment or gh CLI.
 * Priority: 1) env var (GITHUB_TOKEN or custom), 2) `gh auth token`
 */
export function resolveToken(tokenEnv: string = 'GITHUB_TOKEN'): string {
  // 1. Try environment variable
  const envToken = process.env[tokenEnv];
  if (envToken) return envToken;

  // 2. Try gh CLI
  try {
    const token = execSync('gh auth token', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    if (token) return token;
  } catch {
    // gh not installed or not authenticated
  }

  throw new Error(
    `GitHub token not found. Either set ${tokenEnv} environment variable or run "gh auth login".`
  );
}

/**
 * Auto-detect owner/repo from git remote origin.
 * Supports both SSH (git@github.com:owner/repo.git) and HTTPS (https://github.com/owner/repo.git)
 */
export function detectRepoFromGit(): { owner: string; repo: string } | null {
  try {
    const url = execSync('git remote get-url origin', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

    // SSH: git@github.com:owner/repo.git
    const sshMatch = url.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/);
    if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

    // HTTPS: https://github.com/owner/repo.git
    const httpsMatch = url.match(/github\.com\/([^/]+)\/([^/.]+?)(?:\.git)?$/);
    if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };
  } catch {
    // Not a git repo or no remote
  }
  return null;
}

/**
 * Resolve GitHub config from VERSO config.
 * Auto-detects owner/repo from git remote if not specified.
 * The entire `github:` section is optional.
 */
export function resolveGitHubConfig(config: Record<string, unknown>): GitHubConfig {
  const gh = (config as Record<string, unknown>).github as Record<string, unknown> | undefined;

  const configOwner = gh?.owner as string | undefined;
  const configRepo = gh?.repo as string | undefined;
  const token_env = (gh?.token_env as string) || 'GITHUB_TOKEN';
  const base_branch = (gh?.base_branch as string) || 'main';

  let owner = configOwner;
  let repo = configRepo;

  // Auto-detect from git remote if not in config
  if (!owner || !repo) {
    const detected = detectRepoFromGit();
    if (detected) {
      owner = owner || detected.owner;
      repo = repo || detected.repo;
    }
  }

  if (!owner) throw new Error('Cannot determine GitHub owner. Set github.owner in config or ensure git remote origin points to GitHub.');
  if (!repo) throw new Error('Cannot determine GitHub repo. Set github.repo in config or ensure git remote origin points to GitHub.');

  return { owner, repo, token_env, base_branch };
}

export function createClient(config: GitHubConfig): Octokit {
  const token = resolveToken(config.token_env);
  return new Octokit({ auth: token });
}
