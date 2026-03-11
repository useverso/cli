import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createBoardPlugin } from '../src/board.js';

// Mock Linear SDK
const mockCreateIssue = vi.fn();
const mockUpdateIssue = vi.fn();
const mockTeam = vi.fn();
const mockIssueLabels = vi.fn();

const mockTeamStates = vi.fn();
const mockTeamIssues = vi.fn();

vi.mock('@linear/sdk', () => ({
  LinearClient: function () {
    return {
      createIssue: mockCreateIssue,
      updateIssue: mockUpdateIssue,
      team: mockTeam,
      issueLabels: mockIssueLabels,
    };
  },
}));

// Helper to set up default mocks
function setupDefaultMocks() {
  mockIssueLabels.mockResolvedValue({
    nodes: [
      { name: 'feature', id: 'label-feature' },
      { name: 'bug', id: 'label-bug' },
      { name: 'hotfix', id: 'label-hotfix' },
      { name: 'chore', id: 'label-chore' },
      { name: 'refactor', id: 'label-refactor' },
      { name: 'refined', id: 'label-refined' },
      { name: 'pr-ready', id: 'label-pr-ready' },
      { name: 'blocked', id: 'label-blocked' },
    ],
  });

  mockTeamStates.mockResolvedValue({
    nodes: [
      { name: 'Backlog', id: 'state-backlog' },
      { name: 'Todo', id: 'state-todo' },
      { name: 'In Progress', id: 'state-in-progress' },
      { name: 'In Review', id: 'state-in-review' },
      { name: 'Done', id: 'state-done' },
      { name: 'Cancelled', id: 'state-cancelled' },
    ],
  });

  mockTeamIssues.mockResolvedValue({ nodes: [] });

  mockTeam.mockResolvedValue({
    name: 'Test Team',
    states: mockTeamStates,
    issues: mockTeamIssues,
  });
}

const testConfig = {
  linear: {
    api_key: 'lin_api_test_key',
    team_id: 'team-123',
  },
};

const mockCtx = {
  versoDir: '/tmp/.verso',
  config: testConfig,
  board: { schema_version: 1, items: [] },
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.VERSO_LINEAR_API_KEY = 'test-linear-key';
  setupDefaultMocks();
});

describe('board plugin', () => {
  describe('push', () => {
    it('creates new issue when no external_id', async () => {
      const mockIssue = {
        id: 'issue-abc',
        url: 'https://linear.app/team/issue/TEAM-1',
        identifier: 'TEAM-1',
      };
      mockCreateIssue.mockResolvedValue({
        issue: Promise.resolve(mockIssue),
      });

      const plugin = createBoardPlugin(testConfig);
      const items = [{
        id: 1,
        title: 'New feature',
        type: 'feature',
        state: 'captured',
        description: '',
        assignee: '',
        external: {},
        labels: [],
      }];
      const result = await plugin.push(mockCtx as any, items as any);

      expect(result.pushed).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0]).toMatchObject({
        type: 'update',
        itemId: 1,
        fields: {
          external: {
            linear_issue_id: 'issue-abc',
            linear_issue_url: 'https://linear.app/team/issue/TEAM-1',
            linear_issue_identifier: 'TEAM-1',
          },
        },
      });
      expect(mockCreateIssue).toHaveBeenCalledWith(expect.objectContaining({
        teamId: 'team-123',
        title: 'New feature',
      }));
    });

    it('updates existing issue when external_id present', async () => {
      mockUpdateIssue.mockResolvedValue({ success: true });

      const plugin = createBoardPlugin(testConfig);
      const items = [{
        id: 1,
        title: 'Updated feature',
        type: 'feature',
        state: 'building',
        description: 'Some desc',
        assignee: '',
        external: { linear_issue_id: 'issue-abc' },
        labels: [],
      }];
      const result = await plugin.push(mockCtx as any, items as any);

      expect(result.pushed).toBe(1);
      expect(result.actions).toHaveLength(0);
      expect(mockUpdateIssue).toHaveBeenCalledWith('issue-abc', expect.objectContaining({
        title: 'Updated feature',
        description: 'Some desc',
      }));
      expect(mockCreateIssue).not.toHaveBeenCalled();
    });

    it('maps states correctly — building to In Progress', async () => {
      mockUpdateIssue.mockResolvedValue({ success: true });

      const plugin = createBoardPlugin(testConfig);
      const items = [{
        id: 1,
        title: 'Building item',
        type: 'feature',
        state: 'building',
        description: '',
        assignee: '',
        external: { linear_issue_id: 'issue-abc' },
        labels: [],
      }];
      await plugin.push(mockCtx as any, items as any);

      expect(mockUpdateIssue).toHaveBeenCalledWith('issue-abc', expect.objectContaining({
        stateId: 'state-in-progress',
      }));
    });

    it('maps work types to labels — bug gets bug label', async () => {
      mockUpdateIssue.mockResolvedValue({ success: true });

      const plugin = createBoardPlugin(testConfig);
      const items = [{
        id: 1,
        title: 'Fix something',
        type: 'bug',
        state: 'queued',
        description: '',
        assignee: '',
        external: { linear_issue_id: 'issue-abc' },
        labels: [],
      }];
      await plugin.push(mockCtx as any, items as any);

      expect(mockUpdateIssue).toHaveBeenCalledWith('issue-abc', expect.objectContaining({
        labelIds: expect.arrayContaining(['label-bug']),
      }));
    });

    it('handles API error gracefully', async () => {
      mockCreateIssue.mockRejectedValue(new Error('Linear API rate limit'));

      const plugin = createBoardPlugin(testConfig);
      const items = [{
        id: 1,
        title: 'Test',
        type: 'feature',
        state: 'captured',
        description: '',
        assignee: '',
        external: {},
        labels: [],
      }];
      const result = await plugin.push(mockCtx as any, items as any);

      expect(result.pushed).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Linear API rate limit');
    });
  });

  describe('pull', () => {
    it('maps Linear states to VERSO — In Progress to building', async () => {
      mockTeamIssues.mockResolvedValue({
        nodes: [{
          id: 'issue-abc',
          title: 'Existing item',
          url: 'https://linear.app/team/issue/TEAM-1',
          identifier: 'TEAM-1',
          state: Promise.resolve({ name: 'In Progress' }),
          labels: vi.fn().mockResolvedValue({ nodes: [{ name: 'feature' }] }),
        }],
      });

      const ctx = {
        ...mockCtx,
        board: {
          schema_version: 1,
          items: [{
            id: 1,
            title: 'Existing item',
            state: 'queued',
            external: { linear_issue_id: 'issue-abc' },
          }],
        },
      };

      const plugin = createBoardPlugin(testConfig);
      const actions = await plugin.pull(ctx as any);

      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({
        type: 'move',
        itemId: 1,
        to: 'building',
        trigger: 'linear_sync:In Progress',
      });
    });

    it('creates sync action for state change — Done', async () => {
      mockTeamIssues.mockResolvedValue({
        nodes: [{
          id: 'issue-abc',
          title: 'Done item',
          url: 'https://linear.app/team/issue/TEAM-2',
          identifier: 'TEAM-2',
          state: Promise.resolve({ name: 'Done' }),
          labels: vi.fn().mockResolvedValue({ nodes: [] }),
        }],
      });

      const ctx = {
        ...mockCtx,
        board: {
          schema_version: 1,
          items: [{
            id: 2,
            title: 'Done item',
            state: 'building',
            external: { linear_issue_id: 'issue-abc' },
          }],
        },
      };

      const plugin = createBoardPlugin(testConfig);
      const actions = await plugin.pull(ctx as any);

      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({
        type: 'move',
        itemId: 2,
        to: 'done',
        trigger: 'linear_sync:Done',
      });
    });

    it('adds new issues not in board', async () => {
      mockTeamIssues.mockResolvedValue({
        nodes: [{
          id: 'issue-new',
          title: 'New from Linear',
          url: 'https://linear.app/team/issue/TEAM-3',
          identifier: 'TEAM-3',
          state: Promise.resolve({ name: 'Backlog' }),
          labels: vi.fn().mockResolvedValue({ nodes: [{ name: 'bug' }] }),
        }],
      });

      const plugin = createBoardPlugin(testConfig);
      const actions = await plugin.pull(mockCtx as any);

      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({
        type: 'add',
        workType: 'bug',
        title: 'New from Linear',
        external: {
          linear_issue_id: 'issue-new',
          linear_issue_url: 'https://linear.app/team/issue/TEAM-3',
          linear_issue_identifier: 'TEAM-3',
        },
      });
    });

    it('handles empty issue list', async () => {
      mockTeamIssues.mockResolvedValue({ nodes: [] });

      const plugin = createBoardPlugin(testConfig);
      const actions = await plugin.pull(mockCtx as any);

      expect(actions).toHaveLength(0);
    });
  });

  describe('validate', () => {
    it('passes with valid config and API access', async () => {
      process.env.VERSO_LINEAR_API_KEY = 'valid-key';

      const plugin = createBoardPlugin(testConfig);
      const checks = await plugin.validate(mockCtx as any);

      expect(checks).toHaveLength(3);
      expect(checks[0]).toMatchObject({ name: 'linear_api_key', passed: true });
      expect(checks[1]).toMatchObject({ name: 'linear_team_id', passed: true });
      expect(checks[2]).toMatchObject({ name: 'linear_api_access', passed: true });
    });

    it('fails without API key', async () => {
      delete process.env.VERSO_LINEAR_API_KEY;
      const configNoKey = { linear: { api_key: '', team_id: 'team-123' } };

      const plugin = createBoardPlugin(configNoKey);
      const checks = await plugin.validate(mockCtx as any);

      expect(checks[0]).toMatchObject({ name: 'linear_api_key', passed: false });
    });
  });
});

describe('state mapping', () => {
  it('is configurable via state_map override', async () => {
    const customConfig = {
      linear: {
        api_key: 'test-key',
        team_id: 'team-123',
        state_map: {
          captured: 'Triage',
          building: 'Doing',
        },
      },
    };

    // Override mockTeamStates to include custom states
    mockTeamStates.mockResolvedValue({
      nodes: [
        { name: 'Triage', id: 'state-triage' },
        { name: 'Todo', id: 'state-todo' },
        { name: 'Doing', id: 'state-doing' },
        { name: 'In Review', id: 'state-in-review' },
        { name: 'Done', id: 'state-done' },
        { name: 'Cancelled', id: 'state-cancelled' },
        { name: 'Backlog', id: 'state-backlog' },
      ],
    });

    mockUpdateIssue.mockResolvedValue({ success: true });

    const plugin = createBoardPlugin(customConfig);
    const items = [{
      id: 1,
      title: 'Custom state test',
      type: 'feature',
      state: 'building',
      description: '',
      assignee: '',
      external: { linear_issue_id: 'issue-abc' },
      labels: [],
    }];
    await plugin.push(mockCtx as any, items as any);

    // 'building' should map to 'Doing' (custom) instead of 'In Progress' (default)
    expect(mockUpdateIssue).toHaveBeenCalledWith('issue-abc', expect.objectContaining({
      stateId: 'state-doing',
    }));
  });
});
