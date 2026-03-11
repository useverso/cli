import { Octokit } from '@octokit/rest';
import { resolveGitHubConfig, createClient } from './client.js';

interface PrCreateInput { itemId: number; title: string; branch: string; body?: string }
interface PrStatus { id: string; url: string; state: 'open' | 'merged' | 'closed'; mergeable: boolean; checks: { name: string; passed: boolean }[] }
interface PrMergeResult { merged: boolean; sha?: string; error?: string }

export function createReviewPlugin(config: Record<string, unknown>) {
  const ghConfig = resolveGitHubConfig(config);

  return {
    meta: { name: 'github-review', type: 'review', version: '0.1.0' },

    async onPrCreated(ctx: any, input: PrCreateInput): Promise<PrStatus> {
      const client = createClient(ghConfig);
      const { data: pr } = await client.pulls.create({
        owner: ghConfig.owner,
        repo: ghConfig.repo,
        title: input.title,
        head: input.branch,
        base: ghConfig.base_branch || 'main',
        body: input.body || '',
      });
      return {
        id: String(pr.number),
        url: pr.html_url,
        state: 'open',
        mergeable: pr.mergeable ?? true,
        checks: [],
      };
    },

    async getPrStatus(ctx: any, prId: string): Promise<PrStatus> {
      const client = createClient(ghConfig);
      const prNumber = parseInt(prId, 10);
      const { data: pr } = await client.pulls.get({
        owner: ghConfig.owner,
        repo: ghConfig.repo,
        pull_number: prNumber,
      });

      const { data: checksData } = await client.checks.listForRef({
        owner: ghConfig.owner,
        repo: ghConfig.repo,
        ref: pr.head.sha,
      });

      const checks = checksData.check_runs.map((cr: any) => ({
        name: cr.name,
        passed: cr.conclusion === 'success',
      }));

      const state: 'open' | 'merged' | 'closed' = pr.merged
        ? 'merged'
        : pr.state === 'closed'
          ? 'closed'
          : 'open';

      return {
        id: prId,
        url: pr.html_url,
        state,
        mergeable: pr.mergeable ?? false,
        checks,
      };
    },

    async mergePr(ctx: any, prId: string): Promise<PrMergeResult> {
      const client = createClient(ghConfig);
      const prNumber = parseInt(prId, 10);
      try {
        const { data } = await client.pulls.merge({
          owner: ghConfig.owner,
          repo: ghConfig.repo,
          pull_number: prNumber,
          merge_method: 'squash',
        });
        return { merged: data.merged, sha: data.sha };
      } catch (err) {
        return { merged: false, error: (err as Error).message };
      }
    },
  };
}
