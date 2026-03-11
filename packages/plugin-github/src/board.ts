import { Octokit } from '@octokit/rest';
import { resolveGitHubConfig, createClient, type GitHubConfig } from './client.js';
import { STATE_TO_LABEL, buildLabels, detectWorkType, detectVersoState } from './labels.js';

// Define types inline — the plugin should not import from CLI source at runtime.
// These match the interfaces from the VERSO plugin system.

interface PluginMeta { name: string; type: string; version: string }
interface PluginContext { versoDir: string; config: Record<string, unknown>; board: { schema_version: number; items: BoardItem[] } }
interface BoardItem { id: number; title: string; type: string; state: string; external: Record<string, unknown>; [key: string]: unknown }
interface SyncAction { type: string; [key: string]: unknown }
interface SyncResult { pushed: number; actions: SyncAction[]; errors: string[] }
interface DoctorCheck { name: string; passed: boolean; message: string }
interface PluginStatusInfo { label: string; details: string[] }

export function createBoardPlugin(config: Record<string, unknown>) {
  const ghConfig = resolveGitHubConfig(config);

  return {
    meta: { name: 'github-board', type: 'board', version: '0.1.0' } as PluginMeta,

    async setup(ctx: PluginContext): Promise<void> {
      const client = createClient(ghConfig);
      const existingLabels = await client.issues.listLabelsForRepo({
        owner: ghConfig.owner,
        repo: ghConfig.repo,
        per_page: 100,
      });
      const existingNames = new Set(existingLabels.data.map(l => l.name));

      const neededLabels = [
        { name: 'verso', color: '6f42c1', description: 'VERSO-managed item' },
        ...Object.values(STATE_TO_LABEL).map(l => ({ name: l, color: '0e8a16', description: `VERSO state: ${l}` })),
        ...[
          { name: 'type:feature', color: '1d76db' },
          { name: 'type:bug', color: 'd73a4a' },
          { name: 'type:hotfix', color: 'e11d48' },
          { name: 'type:refactor', color: 'fbca04' },
          { name: 'type:chore', color: 'cccccc' },
        ].map(l => ({ ...l, description: 'VERSO work type' })),
      ];

      for (const label of neededLabels) {
        if (!existingNames.has(label.name)) {
          try {
            await client.issues.createLabel({ owner: ghConfig.owner, repo: ghConfig.repo, ...label });
          } catch {
            // Label might already exist (race condition), ignore
          }
        }
      }
    },

    async validate(ctx: PluginContext): Promise<DoctorCheck[]> {
      const checks: DoctorCheck[] = [];
      const token = process.env[ghConfig.token_env];
      checks.push({
        name: 'github_token',
        passed: !!token,
        message: token ? `${ghConfig.token_env} is set` : `${ghConfig.token_env} is not set`,
      });

      if (token) {
        try {
          const client = createClient(ghConfig);
          await client.repos.get({ owner: ghConfig.owner, repo: ghConfig.repo });
          checks.push({ name: 'github_repo_access', passed: true, message: `Can access ${ghConfig.owner}/${ghConfig.repo}` });
        } catch {
          checks.push({ name: 'github_repo_access', passed: false, message: `Cannot access ${ghConfig.owner}/${ghConfig.repo}` });
        }
      }
      return checks;
    },

    async statusInfo(ctx: PluginContext): Promise<PluginStatusInfo> {
      return {
        label: 'GitHub Board',
        details: [`Repository: ${ghConfig.owner}/${ghConfig.repo}`, `Token: ${ghConfig.token_env}`],
      };
    },

    async push(ctx: PluginContext, items: BoardItem[]): Promise<SyncResult> {
      const client = createClient(ghConfig);
      let pushed = 0;
      const errors: string[] = [];
      const actions: SyncAction[] = [];

      for (const item of items) {
        try {
          const issueNumber = item.external.github_issue_number as number | undefined;
          const labels = buildLabels(item as { state: string; type: string });
          const isClosed = item.state === 'done' || item.state === 'cancelled';

          if (issueNumber) {
            await client.issues.update({
              owner: ghConfig.owner,
              repo: ghConfig.repo,
              issue_number: issueNumber,
              title: item.title,
              body: item.description || undefined,
              labels,
              state: isClosed ? 'closed' : 'open',
            });
          } else {
            const { data } = await client.issues.create({
              owner: ghConfig.owner,
              repo: ghConfig.repo,
              title: item.title,
              body: item.description || undefined,
              labels,
            });
            actions.push({
              type: 'update',
              itemId: item.id,
              fields: {
                external: {
                  ...item.external,
                  github_issue_number: data.number,
                  github_issue_url: data.html_url,
                },
              },
            });
          }
          pushed++;
        } catch (err) {
          errors.push(`Item #${item.id}: ${(err as Error).message}`);
        }
      }

      return { pushed, actions, errors };
    },

    async pull(ctx: PluginContext): Promise<SyncAction[]> {
      const client = createClient(ghConfig);
      const actions: SyncAction[] = [];

      const { data: issues } = await client.issues.listForRepo({
        owner: ghConfig.owner,
        repo: ghConfig.repo,
        state: 'all',
        labels: 'verso',
        per_page: 100,
      });

      for (const issue of issues) {
        if ((issue as any).pull_request) continue;

        const existingItem = ctx.board.items.find(
          (i) => i.external.github_issue_number === issue.number,
        );

        if (!existingItem) {
          const workType = detectWorkType(issue.labels as any[]);
          // Note: The 'add' SyncAction type doesn't support description directly.
          // We add a follow-up 'update' action to set the description from the issue body.
          const addAction = {
            type: 'add',
            workType,
            title: issue.title,
            external: {
              github_issue_number: issue.number,
              github_issue_url: issue.html_url,
            },
          };
          actions.push(addAction);

          // If the issue has a body, queue an update action to set description.
          // This will be applied after the item is created.
          if (issue.body) {
            actions.push({
              type: 'update',
              itemId: issue.number, // Temporary: will be replaced by the add action's result
              fields: {
                description: issue.body,
              },
            });
          }
        } else {
          const ghState = detectVersoState(issue as any);
          if (ghState && ghState !== existingItem.state) {
            actions.push({
              type: 'move',
              itemId: existingItem.id,
              to: ghState,
              trigger: `github_sync:${issue.state}`,
            });
          }
        }
      }

      return actions;
    },
  };
}
