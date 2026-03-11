import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveGitHubConfig, createClient, resolveToken, detectRepoFromGit } from '../src/client.js';

// Mock child_process
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'node:child_process';
const mockExecSync = vi.mocked(execSync);

describe('client', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('resolveToken', () => {
    it('uses GITHUB_TOKEN env var when set', () => {
      process.env.GITHUB_TOKEN = 'env-token-123';
      expect(resolveToken()).toBe('env-token-123');
    });

    it('uses custom env var name', () => {
      process.env.MY_TOKEN = 'custom-token';
      expect(resolveToken('MY_TOKEN')).toBe('custom-token');
    });

    it('falls back to gh auth token when env var not set', () => {
      delete process.env.GITHUB_TOKEN;
      mockExecSync.mockReturnValue('gh-cli-token-456\n');
      expect(resolveToken()).toBe('gh-cli-token-456');
      expect(mockExecSync).toHaveBeenCalledWith('gh auth token', expect.any(Object));
    });

    it('throws when neither env var nor gh CLI available', () => {
      delete process.env.GITHUB_TOKEN;
      mockExecSync.mockImplementation(() => { throw new Error('gh not found'); });
      expect(() => resolveToken()).toThrow('GitHub token not found');
    });
  });

  describe('detectRepoFromGit', () => {
    it('detects owner/repo from SSH remote', () => {
      mockExecSync.mockReturnValue('git@github.com:useverso/cli.git\n');
      const result = detectRepoFromGit();
      expect(result).toEqual({ owner: 'useverso', repo: 'cli' });
    });

    it('detects owner/repo from HTTPS remote', () => {
      mockExecSync.mockReturnValue('https://github.com/useverso/cli.git\n');
      const result = detectRepoFromGit();
      expect(result).toEqual({ owner: 'useverso', repo: 'cli' });
    });

    it('handles remote without .git suffix', () => {
      mockExecSync.mockReturnValue('https://github.com/useverso/cli\n');
      const result = detectRepoFromGit();
      expect(result).toEqual({ owner: 'useverso', repo: 'cli' });
    });

    it('returns null when not a git repo', () => {
      mockExecSync.mockImplementation(() => { throw new Error('not a git repo'); });
      expect(detectRepoFromGit()).toBeNull();
    });

    it('returns null for non-GitHub remotes', () => {
      mockExecSync.mockReturnValue('git@gitlab.com:org/repo.git\n');
      expect(detectRepoFromGit()).toBeNull();
    });
  });

  describe('resolveGitHubConfig', () => {
    it('uses explicit config values', () => {
      const config = { github: { owner: 'myorg', repo: 'myrepo', token_env: 'MY_TOKEN' } };
      const result = resolveGitHubConfig(config);
      expect(result.owner).toBe('myorg');
      expect(result.repo).toBe('myrepo');
      expect(result.token_env).toBe('MY_TOKEN');
      expect(result.base_branch).toBe('main');
    });

    it('auto-detects owner/repo from git remote when not in config', () => {
      mockExecSync.mockReturnValue('git@github.com:useverso/cli.git\n');
      const config = { github: {} };
      const result = resolveGitHubConfig(config);
      expect(result.owner).toBe('useverso');
      expect(result.repo).toBe('cli');
    });

    it('works without any github section in config', () => {
      mockExecSync.mockReturnValue('git@github.com:useverso/cli.git\n');
      const result = resolveGitHubConfig({});
      expect(result.owner).toBe('useverso');
      expect(result.repo).toBe('cli');
      expect(result.token_env).toBe('GITHUB_TOKEN');
    });

    it('throws when owner cannot be determined', () => {
      mockExecSync.mockImplementation(() => { throw new Error('not a git repo'); });
      expect(() => resolveGitHubConfig({})).toThrow('Cannot determine GitHub owner');
    });

    it('defaults token_env to GITHUB_TOKEN', () => {
      const config = { github: { owner: 'o', repo: 'r' } };
      expect(resolveGitHubConfig(config).token_env).toBe('GITHUB_TOKEN');
    });
  });

  describe('createClient', () => {
    it('creates Octokit with env token', () => {
      process.env.GITHUB_TOKEN = 'test-token';
      const client = createClient({ owner: 'o', repo: 'r', token_env: 'GITHUB_TOKEN', base_branch: 'main' });
      expect(client).toBeDefined();
      expect(typeof client.issues.create).toBe('function');
    });

    it('creates Octokit with gh CLI token', () => {
      delete process.env.GITHUB_TOKEN;
      mockExecSync.mockReturnValue('gh-token\n');
      const client = createClient({ owner: 'o', repo: 'r', token_env: 'GITHUB_TOKEN', base_branch: 'main' });
      expect(client).toBeDefined();
    });
  });
});
