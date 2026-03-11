import { resolveGitHubConfig, createClient } from './client.js';

export function createDeployPlugin(config: Record<string, unknown>) {
  const ghConfig = resolveGitHubConfig(config);

  return {
    meta: { name: 'github-deploy', type: 'deploy', version: '0.1.0' },

    async deploy(ctx: any, itemId: number): Promise<{ success: boolean; url?: string; error?: string }> {
      const item = ctx.board.items.find((i: any) => i.id === itemId);
      if (!item) return { success: false, error: `Item #${itemId} not found` };

      const ref = item.branch || 'main';
      const client = createClient(ghConfig);

      try {
        const { data: deployment } = await client.repos.createDeployment({
          owner: ghConfig.owner,
          repo: ghConfig.repo,
          ref,
          environment: 'production',
          auto_merge: false,
          required_contexts: [],
        });

        if (typeof deployment === 'object' && 'id' in deployment) {
          return {
            success: true,
            url: `https://github.com/${ghConfig.owner}/${ghConfig.repo}/deployments`,
          };
        }

        return { success: false, error: 'Deployment was not created' };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  };
}
