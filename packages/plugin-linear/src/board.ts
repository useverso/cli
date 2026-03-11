import { resolveLinearConfig, createClient, type LinearConfig } from './client.js';
import { stateToLinear, linearToState, workTypeToLabel, detectWorkType } from './labels.js';

// Define types inline to avoid runtime coupling with CLI source.
// These match the interfaces from the VERSO plugin system.

interface PluginMeta { name: string; type: string; version: string }
interface PluginContext { versoDir: string; config: Record<string, unknown>; board: { schema_version: number; items: BoardItem[] } }
interface BoardItem { id: number; title: string; type: string; state: string; description: string; assignee: string; external: Record<string, unknown>; labels: string[]; [key: string]: unknown }
interface SyncAction { type: string; [key: string]: unknown }
interface SyncResult { pushed: number; actions: SyncAction[]; errors: string[] }
interface DoctorCheck { name: string; passed: boolean; message: string }
interface PluginStatusInfo { label: string; details: string[] }

export function createBoardPlugin(config: Record<string, unknown>) {
  const linearConfig = resolveLinearConfig(config);

  return {
    meta: { name: 'linear-board', type: 'board', version: '0.1.0' } as PluginMeta,

    async validate(ctx: PluginContext): Promise<DoctorCheck[]> {
      const checks: DoctorCheck[] = [];

      // Check API key
      const hasEnvKey = !!process.env.VERSO_LINEAR_API_KEY;
      const hasConfigKey = !!linearConfig.api_key;
      const hasKey = hasEnvKey || hasConfigKey;
      checks.push({
        name: 'linear_api_key',
        passed: hasKey,
        message: hasKey
          ? hasEnvKey ? 'VERSO_LINEAR_API_KEY is set' : 'API key configured in config'
          : 'No Linear API key found. Set VERSO_LINEAR_API_KEY or linear.api_key in config.',
      });

      // Check team_id
      checks.push({
        name: 'linear_team_id',
        passed: !!linearConfig.team_id,
        message: linearConfig.team_id
          ? `Team ID: ${linearConfig.team_id}`
          : 'linear.team_id is not configured',
      });

      // Check API connectivity
      if (hasKey && linearConfig.team_id) {
        try {
          const client = createClient(linearConfig);
          const team = await client.team(linearConfig.team_id);
          checks.push({
            name: 'linear_api_access',
            passed: !!team,
            message: team ? `Connected to team: ${team.name}` : 'Cannot access Linear team',
          });
        } catch {
          checks.push({
            name: 'linear_api_access',
            passed: false,
            message: 'Cannot connect to Linear API',
          });
        }
      }

      return checks;
    },

    async statusInfo(ctx: PluginContext): Promise<PluginStatusInfo> {
      const details = [`Team ID: ${linearConfig.team_id}`];
      if (linearConfig.project_id) {
        details.push(`Project ID: ${linearConfig.project_id}`);
      }

      try {
        const client = createClient(linearConfig);
        const team = await client.team(linearConfig.team_id);
        if (team) details[0] = `Team: ${team.name}`;
      } catch {
        // Use team ID as fallback
      }

      return { label: 'Linear Board', details };
    },

    async push(ctx: PluginContext, items: BoardItem[]): Promise<SyncResult> {
      const client = createClient(linearConfig);
      let pushed = 0;
      const errors: string[] = [];
      const actions: SyncAction[] = [];

      // Fetch workflow states for the team to resolve state IDs
      const team = await client.team(linearConfig.team_id);
      const workflowStates = await team.states();
      const stateMap = new Map(workflowStates.nodes.map(s => [s.name, s.id]));

      // Fetch existing labels to find/create work type labels
      const existingLabels = await client.issueLabels();
      const labelMap = new Map(existingLabels.nodes.map(l => [l.name, l.id]));

      for (const item of items) {
        try {
          const externalId = item.external.linear_issue_id as string | undefined;
          const { stateName, label: disambigLabel } = stateToLinear(item.state, linearConfig.state_map);
          const stateId = stateMap.get(stateName);
          const workTypeLabel = workTypeToLabel(item.type);

          // Build label IDs
          const labelIds: string[] = [];
          if (labelMap.has(workTypeLabel)) {
            labelIds.push(labelMap.get(workTypeLabel)!);
          }
          if (disambigLabel && labelMap.has(disambigLabel)) {
            labelIds.push(labelMap.get(disambigLabel)!);
          }

          if (externalId) {
            // Update existing Linear issue
            await client.updateIssue(externalId, {
              title: item.title,
              description: item.description || undefined,
              stateId,
              labelIds,
              ...(item.assignee ? { assigneeId: item.assignee } : {}),
            });
          } else {
            // Create new Linear issue
            const issuePayload = await client.createIssue({
              teamId: linearConfig.team_id,
              title: item.title,
              description: item.description || undefined,
              stateId,
              labelIds,
              ...(linearConfig.project_id ? { projectId: linearConfig.project_id } : {}),
            });
            const issue = await issuePayload.issue;
            if (issue) {
              actions.push({
                type: 'update',
                itemId: item.id,
                fields: {
                  external: {
                    ...item.external,
                    linear_issue_id: issue.id,
                    linear_issue_url: issue.url,
                    linear_issue_identifier: issue.identifier,
                  },
                },
              });
            }
          }
          pushed++;
        } catch (err) {
          errors.push(`Item #${item.id}: ${(err as Error).message}`);
        }
      }

      return { pushed, actions, errors };
    },

    async pull(ctx: PluginContext): Promise<SyncAction[]> {
      const client = createClient(linearConfig);
      const actions: SyncAction[] = [];

      // Fetch issues from the team (optionally filtered by project)
      const team = await client.team(linearConfig.team_id);
      const issuesConnection = await team.issues({
        first: 100,
        ...(linearConfig.project_id
          ? { filter: { project: { id: { eq: linearConfig.project_id } } } }
          : {}),
      });

      for (const issue of issuesConnection.nodes) {
        const issueState = await issue.state;
        const issueLabels = await issue.labels();
        const labelNames = issueLabels.nodes.map(l => l.name);
        const linearStateName = issueState?.name || 'Backlog';

        const existingItem = ctx.board.items.find(
          (i) => i.external.linear_issue_id === issue.id,
        );

        if (!existingItem) {
          // New issue from Linear — add to board
          const workType = detectWorkType(labelNames);
          actions.push({
            type: 'add',
            workType,
            title: issue.title,
            external: {
              linear_issue_id: issue.id,
              linear_issue_url: issue.url,
              linear_issue_identifier: issue.identifier,
            },
          });
        } else {
          // Existing item — check for state changes
          const versoState = linearToState(linearStateName, labelNames, linearConfig.state_map);
          if (versoState !== existingItem.state) {
            actions.push({
              type: 'move',
              itemId: existingItem.id,
              to: versoState,
              trigger: `linear_sync:${linearStateName}`,
            });
          }
        }
      }

      return actions;
    },
  };
}
