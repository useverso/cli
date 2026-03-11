import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createCiPlugin } from '../src/ci.js';

// Create mock functions
const mockChecksListForRef = vi.fn();

// Mock Octokit — must use function (not arrow) so it works with `new`
vi.mock('@octokit/rest', () => ({
  Octokit: function () {
    return {
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

describe('ci plugin', () => {
  it('getCheckStatus returns mapped results', async () => {
    mockChecksListForRef.mockResolvedValue({
      data: {
        check_runs: [
          { name: 'lint', conclusion: 'success' },
          { name: 'test', conclusion: 'failure' },
          { name: 'build', conclusion: 'success' },
        ],
      },
    });

    const plugin = createCiPlugin(testConfig);
    const result = await plugin.getCheckStatus({} as any, 'feat/login');

    expect(result).toEqual([
      { name: 'lint', passed: true },
      { name: 'test', passed: false },
      { name: 'build', passed: true },
    ]);
    expect(mockChecksListForRef).toHaveBeenCalledWith(expect.objectContaining({
      owner: 'testorg',
      repo: 'testrepo',
      ref: 'feat/login',
    }));
  });

  it('getCheckStatus handles empty check runs', async () => {
    mockChecksListForRef.mockResolvedValue({
      data: { check_runs: [] },
    });

    const plugin = createCiPlugin(testConfig);
    const result = await plugin.getCheckStatus({} as any, 'main');

    expect(result).toEqual([]);
  });
});
