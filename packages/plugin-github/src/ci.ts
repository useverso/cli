import { resolveGitHubConfig, createClient } from './client.js';

export function createCiPlugin(config: Record<string, unknown>) {
  const ghConfig = resolveGitHubConfig(config);

  return {
    meta: { name: 'github-ci', type: 'ci', version: '0.1.0' },

    async getCheckStatus(ctx: any, branch: string): Promise<{ name: string; passed: boolean }[]> {
      const client = createClient(ghConfig);
      const { data } = await client.checks.listForRef({
        owner: ghConfig.owner,
        repo: ghConfig.repo,
        ref: branch,
      });
      return data.check_runs.map((cr: any) => ({
        name: cr.name,
        passed: cr.conclusion === 'success',
      }));
    },
  };
}
