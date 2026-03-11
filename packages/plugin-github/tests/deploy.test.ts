import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createDeployPlugin } from '../src/deploy.js';

// Create mock functions
const mockCreateDeployment = vi.fn();

// Mock Octokit — must use function (not arrow) so it works with `new`
vi.mock('@octokit/rest', () => ({
  Octokit: function () {
    return {
      repos: {
        createDeployment: mockCreateDeployment,
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

describe('deploy plugin', () => {
  it('creates deployment and returns success', async () => {
    mockCreateDeployment.mockResolvedValue({
      data: { id: 101 },
    });

    const ctx = {
      board: { items: [{ id: 1, title: 'Feature', branch: 'feat/login' }] },
    };

    const plugin = createDeployPlugin(testConfig);
    const result = await plugin.deploy(ctx as any, 1);

    expect(result).toEqual({
      success: true,
      url: 'https://github.com/testorg/testrepo/deployments',
    });
    expect(mockCreateDeployment).toHaveBeenCalledWith(expect.objectContaining({
      owner: 'testorg',
      repo: 'testrepo',
      ref: 'feat/login',
      environment: 'production',
    }));
  });

  it('returns error for missing item', async () => {
    const ctx = {
      board: { items: [] },
    };

    const plugin = createDeployPlugin(testConfig);
    const result = await plugin.deploy(ctx as any, 99);

    expect(result).toEqual({ success: false, error: 'Item #99 not found' });
    expect(mockCreateDeployment).not.toHaveBeenCalled();
  });

  it('handles API error', async () => {
    mockCreateDeployment.mockRejectedValue(new Error('Forbidden'));

    const ctx = {
      board: { items: [{ id: 1, title: 'Feature', branch: 'feat/login' }] },
    };

    const plugin = createDeployPlugin(testConfig);
    const result = await plugin.deploy(ctx as any, 1);

    expect(result).toEqual({ success: false, error: 'Forbidden' });
  });
});
