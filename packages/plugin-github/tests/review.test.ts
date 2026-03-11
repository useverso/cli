import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createReviewPlugin } from '../src/review.js';

// Create mock functions
const mockPullsCreate = vi.fn();
const mockPullsGet = vi.fn();
const mockPullsMerge = vi.fn();
const mockChecksListForRef = vi.fn();

// Mock Octokit — must use function (not arrow) so it works with `new`
vi.mock('@octokit/rest', () => ({
  Octokit: function () {
    return {
      pulls: {
        create: mockPullsCreate,
        get: mockPullsGet,
        merge: mockPullsMerge,
      },
      checks: {
        listForRef: mockChecksListForRef,
      },
    };
  },
}));

const testConfig = {
  github: { owner: 'testorg', repo: 'testrepo', token_env: 'GITHUB_TOKEN' },
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GITHUB_TOKEN = 'test-token';
});

describe('review plugin', () => {
  it('onPrCreated creates PR and returns PrStatus', async () => {
    mockPullsCreate.mockResolvedValue({
      data: { number: 7, html_url: 'https://github.com/testorg/testrepo/pull/7', mergeable: true },
    });
    const plugin = createReviewPlugin(testConfig);
    const result = await plugin.onPrCreated({} as any, {
      itemId: 1,
      title: 'feat: add login',
      branch: 'feat/login',
      body: 'Adds login flow',
    });

    expect(result).toMatchObject({
      id: '7',
      url: 'https://github.com/testorg/testrepo/pull/7',
      state: 'open',
      mergeable: true,
      checks: [],
    });
    expect(mockPullsCreate).toHaveBeenCalledWith(expect.objectContaining({
      owner: 'testorg',
      repo: 'testrepo',
      title: 'feat: add login',
      head: 'feat/login',
      base: 'main',
      body: 'Adds login flow',
    }));
  });

  it('getPrStatus maps open state correctly', async () => {
    mockPullsGet.mockResolvedValue({
      data: {
        number: 7,
        html_url: 'https://github.com/testorg/testrepo/pull/7',
        state: 'open',
        merged: false,
        mergeable: true,
        head: { sha: 'abc123' },
      },
    });
    mockChecksListForRef.mockResolvedValue({
      data: { check_runs: [] },
    });

    const plugin = createReviewPlugin(testConfig);
    const result = await plugin.getPrStatus({} as any, '7');

    expect(result).toMatchObject({
      id: '7',
      state: 'open',
      mergeable: true,
      checks: [],
    });
  });

  it('getPrStatus maps merged state and includes check runs', async () => {
    mockPullsGet.mockResolvedValue({
      data: {
        number: 7,
        html_url: 'https://github.com/testorg/testrepo/pull/7',
        state: 'closed',
        merged: true,
        mergeable: false,
        head: { sha: 'abc123' },
      },
    });
    mockChecksListForRef.mockResolvedValue({
      data: {
        check_runs: [
          { name: 'lint', conclusion: 'success' },
          { name: 'test', conclusion: 'failure' },
        ],
      },
    });

    const plugin = createReviewPlugin(testConfig);
    const result = await plugin.getPrStatus({} as any, '7');

    expect(result.state).toBe('merged');
    expect(result.checks).toEqual([
      { name: 'lint', passed: true },
      { name: 'test', passed: false },
    ]);
  });

  it('mergePr succeeds and returns sha', async () => {
    mockPullsMerge.mockResolvedValue({
      data: { merged: true, sha: 'merge-sha-123' },
    });

    const plugin = createReviewPlugin(testConfig);
    const result = await plugin.mergePr({} as any, '7');

    expect(result).toEqual({ merged: true, sha: 'merge-sha-123' });
    expect(mockPullsMerge).toHaveBeenCalledWith(expect.objectContaining({
      pull_number: 7,
      merge_method: 'squash',
    }));
  });

  it('mergePr returns error on failure', async () => {
    mockPullsMerge.mockRejectedValue(new Error('Not mergeable'));

    const plugin = createReviewPlugin(testConfig);
    const result = await plugin.mergePr({} as any, '7');

    expect(result).toEqual({ merged: false, error: 'Not mergeable' });
  });
});
