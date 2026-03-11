import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createBoardPlugin } from '../src/board.js';

// Create mock functions
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockListForRepo = vi.fn();
const mockReposGet = vi.fn();
const mockListLabelsForRepo = vi.fn();
const mockCreateLabel = vi.fn();

// Mock Octokit — must use function (not arrow) so it works with `new`
vi.mock('@octokit/rest', () => ({
  Octokit: function () {
    return {
      issues: {
        create: mockCreate,
        update: mockUpdate,
        listForRepo: mockListForRepo,
        listLabelsForRepo: mockListLabelsForRepo,
        createLabel: mockCreateLabel,
      },
      repos: { get: mockReposGet },
    };
  },
}));

const testConfig = {
  github: { owner: 'testorg', repo: 'testrepo', token_env: 'GITHUB_TOKEN' },
};

const mockCtx = {
  versoDir: '/tmp/.verso',
  config: testConfig,
  board: { schema_version: 1, items: [] },
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GITHUB_TOKEN = 'test-token';
});

describe('board plugin', () => {
  describe('push', () => {
    it('creates new issue and returns update action with issue number', async () => {
      mockCreate.mockResolvedValue({ data: { number: 42, html_url: 'https://github.com/testorg/testrepo/issues/42' } });
      const plugin = createBoardPlugin(testConfig);
      const items = [{ id: 1, title: 'Test item', type: 'feature', state: 'captured', external: {} }];
      const result = await plugin.push(mockCtx as any, items as any);

      expect(result.pushed).toBe(1);
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0]).toMatchObject({
        type: 'update',
        itemId: 1,
        fields: { external: { github_issue_number: 42 } },
      });
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
        owner: 'testorg',
        repo: 'testrepo',
        title: 'Test item',
      }));
    });

    it('updates existing issue when github_issue_number exists', async () => {
      mockUpdate.mockResolvedValue({ data: {} });
      const plugin = createBoardPlugin(testConfig);
      const items = [{ id: 1, title: 'Updated', type: 'feature', state: 'building', external: { github_issue_number: 42 } }];
      const result = await plugin.push(mockCtx as any, items as any);

      expect(result.pushed).toBe(1);
      expect(result.actions).toHaveLength(0);
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
        issue_number: 42,
        state: 'open',
      }));
    });

    it('closes done/cancelled items', async () => {
      mockUpdate.mockResolvedValue({ data: {} });
      const plugin = createBoardPlugin(testConfig);
      const items = [{ id: 1, title: 'Done', type: 'feature', state: 'done', external: { github_issue_number: 42 } }];
      await plugin.push(mockCtx as any, items as any);

      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
        state: 'closed',
      }));
    });

    it('handles API error gracefully', async () => {
      mockCreate.mockRejectedValue(new Error('API rate limit'));
      const plugin = createBoardPlugin(testConfig);
      const items = [{ id: 1, title: 'Test', type: 'feature', state: 'captured', external: {} }];
      const result = await plugin.push(mockCtx as any, items as any);

      expect(result.pushed).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('API rate limit');
    });
  });

  describe('pull', () => {
    it('returns add action for unknown issue', async () => {
      mockListForRepo.mockResolvedValue({ data: [
        { number: 99, title: 'New from GH', state: 'open', html_url: 'https://...', labels: [{ name: 'verso' }, { name: 'type:bug' }] },
      ]});
      const plugin = createBoardPlugin(testConfig);
      const actions = await plugin.pull(mockCtx as any);

      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({ type: 'add', workType: 'bug', title: 'New from GH' });
    });

    it('returns move action for state change', async () => {
      const ctx = {
        ...mockCtx,
        board: {
          schema_version: 1,
          items: [{ id: 1, title: 'Existing', state: 'captured', external: { github_issue_number: 42 } }],
        },
      };
      mockListForRepo.mockResolvedValue({ data: [
        { number: 42, title: 'Existing', state: 'closed', html_url: 'https://...', labels: [{ name: 'verso' }] },
      ]});
      const plugin = createBoardPlugin(testConfig);
      const actions = await plugin.pull(ctx as any);

      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({ type: 'move', itemId: 1, to: 'done' });
    });

    it('skips pull requests', async () => {
      mockListForRepo.mockResolvedValue({ data: [
        { number: 10, title: 'PR', state: 'open', html_url: 'https://...', labels: [{ name: 'verso' }], pull_request: {} },
      ]});
      const plugin = createBoardPlugin(testConfig);
      const actions = await plugin.pull(mockCtx as any);

      expect(actions).toHaveLength(0);
    });

    it('handles empty issue list', async () => {
      mockListForRepo.mockResolvedValue({ data: [] });
      const plugin = createBoardPlugin(testConfig);
      const actions = await plugin.pull(mockCtx as any);

      expect(actions).toHaveLength(0);
    });
  });

  describe('validate', () => {
    it('passes with valid token and repo access', async () => {
      process.env.GITHUB_TOKEN = 'valid-token';
      mockReposGet.mockResolvedValue({ data: {} });
      const plugin = createBoardPlugin(testConfig);
      const checks = await plugin.validate(mockCtx as any);

      expect(checks).toHaveLength(2);
      expect(checks[0]).toMatchObject({ name: 'github_token', passed: true });
      expect(checks[1]).toMatchObject({ name: 'github_repo_access', passed: true });
    });

    it('fails without token', async () => {
      delete process.env.GITHUB_TOKEN;
      const plugin = createBoardPlugin(testConfig);
      const checks = await plugin.validate(mockCtx as any);

      expect(checks).toHaveLength(1);
      expect(checks[0]).toMatchObject({ name: 'github_token', passed: false });
    });
  });
});
