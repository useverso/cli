# VERSO Plugin Development Guide

Plugins extend VERSO by integrating external services into the development lifecycle. This guide covers everything you need to build, test, and publish a VERSO plugin.

## Overview

VERSO supports **6 plugin types**, each responsible for a specific concern:

| Type | Purpose | Key Methods |
|------|---------|-------------|
| `board` | Sync work items with external trackers | `push`, `pull` |
| `review` | Manage pull requests and code review | `onPrCreated`, `getPrStatus`, `mergePr` |
| `ci` | Query CI/CD check status | `getCheckStatus` |
| `deploy` | Trigger deployments | `deploy` |
| `monitor` | Ingest production alerts as work items | `getAlerts` |
| `notify` | Send notifications to external channels | `send` |

Plugins are loaded via **ESM dynamic import** at runtime. VERSO resolves plugin packages by naming convention, instantiates them with config, and validates their shape before use.

The canonical reference implementation is [`@useverso/plugin-github`](./packages/plugin-github/), which implements `board`, `review`, `ci`, and `deploy` in a single package.

## Quick Start

### 1. Create the package

```bash
mkdir verso-plugin-acme && cd verso-plugin-acme
npm init -y
```

Set `"type": "module"` in `package.json` (VERSO uses ESM dynamic imports).

### 2. Naming convention

VERSO tries two package names when resolving a plugin:

1. `@useverso/plugin-{name}` (scoped, official)
2. `verso-plugin-{name}` (community)

When a user sets `plugins.board: acme` in their config, VERSO will attempt to import `@useverso/plugin-acme` first, then `verso-plugin-acme`.

### 3. Required exports

Your package must export a **factory function** for each plugin type it provides. The export name must match the plugin type:

```typescript
// Named export matching the plugin type
export function board(config: Record<string, unknown>) {
  return { /* BoardPlugin */ };
}
```

Alternatively, if your package provides only one plugin type, you can use a `default` export:

```typescript
export default function(config: Record<string, unknown>) {
  return { /* plugin */ };
}
```

For multi-type packages (like `@useverso/plugin-github`), use named exports:

```typescript
export { createBoardPlugin as board } from './board.js';
export { createReviewPlugin as review } from './review.js';
export { createCiPlugin as ci } from './ci.js';
export { createDeployPlugin as deploy } from './deploy.js';
```

### 4. Minimal BoardPlugin example

```typescript
import type { BoardPlugin, PluginContext, BoardItem, SyncResult, SyncAction } from '@useverso/cli/plugin-api';

export function board(config: Record<string, unknown>): BoardPlugin {
  return {
    meta: { name: 'acme-board', type: 'board', version: '0.1.0' },

    async push(ctx: PluginContext, items: BoardItem[]): Promise<SyncResult> {
      let pushed = 0;
      const errors: string[] = [];
      const actions: SyncAction[] = [];

      for (const item of items) {
        try {
          // Push item to your external service
          // await acmeClient.createOrUpdate(item);
          pushed++;
        } catch (err) {
          errors.push(`Item #${item.id}: ${(err as Error).message}`);
        }
      }

      return { pushed, actions, errors };
    },

    async pull(ctx: PluginContext): Promise<SyncAction[]> {
      const actions: SyncAction[] = [];
      // Fetch items from external service and return sync actions
      return actions;
    },
  };
}
```

## Plugin Types Reference

All plugins extend `BasePlugin`:

```typescript
interface BasePlugin {
  meta: PluginMeta;
  setup?(ctx: PluginContext): Promise<void>;
  validate?(ctx: PluginContext): Promise<DoctorCheck[]>;
  statusInfo?(ctx: PluginContext): Promise<PluginStatusInfo>;
}

interface PluginMeta {
  name: string;
  type: PluginType;   // 'board' | 'review' | 'ci' | 'deploy' | 'monitor' | 'notify'
  version: string;
}

interface PluginContext {
  versoDir: string;
  config: VersoConfig;
  board: BoardFile;
}

interface DoctorCheck {
  name: string;
  passed: boolean;
  message: string;
}

interface PluginStatusInfo {
  label: string;
  details: string[];
}
```

The optional methods:

- **`setup(ctx)`** -- Called once during `verso init`. Use it to provision resources (e.g., create labels in GitHub).
- **`validate(ctx)`** -- Called by `verso doctor`. Return checks for credentials, connectivity, permissions.
- **`statusInfo(ctx)`** -- Called by `verso status`. Return a summary label and detail lines for display.

---

### BoardPlugin

Syncs work items between `.verso/board.yaml` and an external tracker.

```typescript
interface BoardPlugin extends BasePlugin {
  push(ctx: PluginContext, items: BoardItem[]): Promise<SyncResult>;
  pull(ctx: PluginContext): Promise<SyncAction[]>;
}
```

**`push(ctx, items)`** -- Push local items to the external service. Return a `SyncResult`:

```typescript
interface SyncResult {
  pushed: number;         // Number of items successfully pushed
  actions: SyncAction[];  // Actions to apply back to the local board (e.g., store external IDs)
  errors: string[];       // Human-readable error messages
}
```

**`pull(ctx)`** -- Fetch state from the external service and return `SyncAction[]` to update the local board:

```typescript
type SyncAction =
  | { type: 'move'; itemId: number; to: State; trigger: string }
  | { type: 'update'; itemId: number; fields: Partial<BoardItem> }
  | { type: 'add'; workType: WorkType; title: string; external?: Record<string, unknown> };
```

**Example** (simplified from `@useverso/plugin-github`):

```typescript
export function board(config: Record<string, unknown>) {
  const ghConfig = resolveConfig(config);

  return {
    meta: { name: 'github-board', type: 'board', version: '0.1.0' },

    async push(ctx, items) {
      const client = createClient(ghConfig);
      let pushed = 0;
      const errors = [];
      const actions = [];

      for (const item of items) {
        const issueNumber = item.external.github_issue_number;
        if (issueNumber) {
          await client.issues.update({ owner, repo, issue_number: issueNumber, title: item.title });
        } else {
          const { data } = await client.issues.create({ owner, repo, title: item.title });
          actions.push({
            type: 'update',
            itemId: item.id,
            fields: { external: { ...item.external, github_issue_number: data.number } },
          });
        }
        pushed++;
      }
      return { pushed, actions, errors };
    },

    async pull(ctx) {
      const client = createClient(ghConfig);
      const { data: issues } = await client.issues.listForRepo({ owner, repo, labels: 'verso' });
      const actions = [];

      for (const issue of issues) {
        const existing = ctx.board.items.find(i => i.external.github_issue_number === issue.number);
        if (!existing) {
          actions.push({ type: 'add', workType: 'feature', title: issue.title, external: { github_issue_number: issue.number } });
        }
      }
      return actions;
    },
  };
}
```

---

### ReviewPlugin

Manages pull requests and code review.

```typescript
interface ReviewPlugin extends BasePlugin {
  onPrCreated(ctx: PluginContext, input: PrCreateInput): Promise<PrStatus>;
  getPrStatus(ctx: PluginContext, prId: string): Promise<PrStatus>;
  mergePr(ctx: PluginContext, prId: string): Promise<PrMergeResult>;
}

interface PrCreateInput {
  itemId: number;
  title: string;
  branch: string;
  body?: string;
}

interface PrStatus {
  id: string;
  url: string;
  state: 'open' | 'merged' | 'closed';
  mergeable: boolean;
  checks: { name: string; passed: boolean }[];
}

interface PrMergeResult {
  merged: boolean;
  sha?: string;
  error?: string;
}
```

**`onPrCreated(ctx, input)`** -- Create a PR on the external service. Return its status.

**`getPrStatus(ctx, prId)`** -- Fetch current PR state, mergeability, and check results.

**`mergePr(ctx, prId)`** -- Merge the PR. Return whether it succeeded and the merge SHA.

---

### CiPlugin

Queries CI check status for a branch.

```typescript
interface CiPlugin extends BasePlugin {
  getCheckStatus(ctx: PluginContext, branch: string): Promise<{ name: string; passed: boolean }[]>;
}
```

**`getCheckStatus(ctx, branch)`** -- Return the list of CI checks and their pass/fail status for the given branch.

**Example:**

```typescript
export function ci(config: Record<string, unknown>) {
  const ghConfig = resolveConfig(config);

  return {
    meta: { name: 'github-ci', type: 'ci', version: '0.1.0' },

    async getCheckStatus(ctx, branch) {
      const client = createClient(ghConfig);
      const { data } = await client.checks.listForRef({ owner, repo, ref: branch });
      return data.check_runs.map(cr => ({
        name: cr.name,
        passed: cr.conclusion === 'success',
      }));
    },
  };
}
```

---

### DeployPlugin

Triggers deployments.

```typescript
interface DeployPlugin extends BasePlugin {
  deploy(ctx: PluginContext, itemId: number): Promise<{ success: boolean; url?: string; error?: string }>;
}
```

**`deploy(ctx, itemId)`** -- Deploy the work item. The item's branch and metadata are available via `ctx.board.items`. Return success status and optionally a deployment URL.

---

### MonitorPlugin

Ingests production alerts and converts them into board actions.

```typescript
interface MonitorPlugin extends BasePlugin {
  getAlerts(ctx: PluginContext): Promise<SyncAction[]>;
}
```

**`getAlerts(ctx)`** -- Fetch alerts from a monitoring service (Sentry, Datadog, etc.) and return `SyncAction[]`. Typically returns `'add'` actions to create new work items from alerts.

---

### NotifyPlugin

Sends notifications to external channels (Slack, email, webhooks).

```typescript
interface NotifyPlugin extends BasePlugin {
  send(ctx: PluginContext, message: string, channel?: string): Promise<void>;
}
```

**`send(ctx, message, channel?)`** -- Deliver the message. The optional `channel` parameter allows routing to specific channels/topics.

## Configuration

### How users configure plugins

Plugins are configured in `.verso/config.yaml` under the `plugins` key. The value for each plugin type is the short name used for package resolution:

```yaml
# .verso/config.yaml

plugins:
  board: github
  review: github
  ci: github
  deploy: github
```

With this config, VERSO resolves `github` to `@useverso/plugin-github` (or `verso-plugin-github`).

### Plugin-specific config sections

Plugins receive the **entire `VersoConfig`** object (cast to `Record<string, unknown>`) when their factory function is called. Add plugin-specific configuration as a top-level key in `config.yaml`:

```yaml
# Plugin-specific config (add alongside other config sections)
github:
  owner: your-org
  repo: your-repo
  token_env: GITHUB_TOKEN    # env var name containing the token
  base_branch: main
```

Inside your factory function, read your config section:

```typescript
export function board(config: Record<string, unknown>) {
  const myConfig = config.acme as { apiKey: string; workspace: string };
  // ...
}
```

### Auto-install during `verso init`

When a user selects a plugin during interactive `verso init`, the CLI automatically runs `npm install @useverso/plugin-{name}` and adds the `plugins:` section to `config.yaml`. Plugin packages that follow the naming convention are discovered automatically.

## Loading & Resolution

### How VERSO discovers plugins

1. Read `plugins` from `config.yaml` (e.g., `{ board: "github" }`)
2. For each entry, generate candidate package names: `@useverso/plugin-github`, `verso-plugin-github`
3. Attempt ESM `import()` of each candidate, resolved from the user's project `node_modules`
4. Look for a named export matching the plugin type (e.g., `mod.board`), falling back to `mod.default`
5. Call the factory function with the config object
6. Validate the returned plugin's shape

### Plugin validation (shape checking)

VERSO validates every loaded plugin before use:

- **`meta`** must be an object with `name` (string), `type` (string), and `version` (string)
- **`meta.type`** must match the expected plugin type
- All **required methods** for the type must be present and be functions

Required methods per type:

| Type | Required Methods |
|------|-----------------|
| `board` | `push`, `pull` |
| `review` | `onPrCreated`, `getPrStatus`, `mergePr` |
| `ci` | `getCheckStatus` |
| `deploy` | `deploy` |
| `monitor` | `getAlerts` |
| `notify` | `send` |

### Error handling

- If no candidate package is found: `PluginLoadError` with the list of tried package names
- If the package loads but has no matching export: `PluginLoadError` with details
- If shape validation fails: `PluginLoadError` listing the specific missing methods or invalid meta fields

## Testing

### Recommended setup

Use [Vitest](https://vitest.dev/) (VERSO's test runner). Mock external API clients and test plugin behavior in isolation.

**Example test structure** (from `@useverso/plugin-github`):

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createBoardPlugin } from '../src/board.js';

// Mock external dependencies
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockListForRepo = vi.fn();

vi.mock('@octokit/rest', () => ({
  Octokit: function () {
    return {
      issues: {
        create: mockCreate,
        update: mockUpdate,
        listForRepo: mockListForRepo,
      },
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
  it('creates new issue and returns update action', async () => {
    mockCreate.mockResolvedValue({
      data: { number: 42, html_url: 'https://github.com/testorg/testrepo/issues/42' },
    });

    const plugin = createBoardPlugin(testConfig);
    const items = [{ id: 1, title: 'Test', type: 'feature', state: 'captured', external: {} }];
    const result = await plugin.push(mockCtx as any, items as any);

    expect(result.pushed).toBe(1);
    expect(result.actions[0]).toMatchObject({
      type: 'update',
      itemId: 1,
      fields: { external: { github_issue_number: 42 } },
    });
  });
});
```

### Testing the plugin loader

You can also test that your plugin loads correctly through VERSO's loader by injecting a custom resolver:

```typescript
import { loadPlugin, type PluginResolver } from '@useverso/cli';

const mockResolver: PluginResolver = async (packageName: string) => {
  if (packageName === '@useverso/plugin-acme') {
    return { board: (config) => myPlugin };
  }
  throw new Error('Not found');
};

const plugin = await loadPlugin('acme', 'board', {}, '/tmp', mockResolver);
```

## Publishing

### package.json requirements

```json
{
  "name": "@useverso/plugin-acme",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "keywords": ["verso", "plugin"],
  "peerDependencies": {
    "@useverso/cli": "^0.1.0"
  }
}
```

Key points:

- **`"type": "module"`** is required. VERSO loads plugins via ESM `import()`.
- **`peerDependencies`** on `@useverso/cli` ensures type compatibility without bundling the CLI.
- **`keywords`** should include `"verso"` and `"plugin"` for discoverability.
- **`main`** must point to your compiled ESM entry point.

### Import path for types

Plugin authors import types from the dedicated plugin API entry point:

```typescript
import type { BoardPlugin, PluginContext, SyncResult } from '@useverso/cli/plugin-api';
```

This path (`@useverso/cli/plugin-api`) re-exports all plugin interfaces, board types, config types, and state types needed for plugin development.

### NPM publishing

```bash
npm run build
npm publish --access public
```

For scoped packages under `@useverso/*`, coordinate with the VERSO team. Community plugins should use the `verso-plugin-{name}` convention and can be published independently.
