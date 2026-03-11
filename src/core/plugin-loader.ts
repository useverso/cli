import type { VersoConfig } from './config.js';
import type { BoardFile, BoardItem, State } from './types.js';
import { createDefaultItem } from './types.js';
import type {
  PluginType,
  PluginFactory,
  VersoPlugin,
  SyncAction,
} from './plugin.js';
import {
  validatePluginShape,
  resolvePackageName,
} from './plugin.js';
import { PluginLoadError } from './error.js';
import { canTransition, checkWipGuard } from './state-machine.js';

export interface LoadedPlugins {
  board?: VersoPlugin;
  review?: VersoPlugin;
  ci?: VersoPlugin;
  deploy?: VersoPlugin;
  monitor?: VersoPlugin;
  notify?: VersoPlugin;
}

// Injectable resolver type for testability
export type PluginResolver = (packageName: string) => Promise<Record<string, unknown>>;

// Default resolver uses dynamic import from the user's project directory
const defaultResolver: PluginResolver = async (packageName: string) => {
  try {
    // Resolve from cwd (where user's node_modules lives)
    const { createRequire } = await import('node:module');
    const { pathToFileURL } = await import('node:url');
    const req = createRequire(process.cwd() + '/package.json');
    const resolved = req.resolve(packageName);
    // ESM import() needs file:// URLs for absolute paths
    return import(pathToFileURL(resolved).href);
  } catch (err) {
    // Fall back to direct import (works when plugin is in CLI's node_modules)
    try {
      return await import(packageName);
    } catch {
      throw err; // Re-throw original error for better diagnostics
    }
  }
};

export async function loadPlugin(
  shortName: string,
  expectedType: PluginType,
  pluginConfig: Record<string, unknown>,
  projectRoot: string,
  resolver: PluginResolver = defaultResolver,
): Promise<VersoPlugin> {
  const candidates = resolvePackageName(shortName);
  let lastError: Error | null = null;

  for (const candidate of candidates) {
    let mod: Record<string, unknown>;
    try {
      mod = await resolver(candidate);
    } catch {
      lastError = new Error(`Could not import ${candidate}`);
      continue;
    }

    // Package loaded — any error from here is a plugin error, not "not found"
    const factory = (mod as Record<string, unknown>)[expectedType] ?? mod.default;

    if (typeof factory !== 'function') {
      throw new PluginLoadError(shortName, `No "${expectedType}" export or default export found`);
    }

    try {
      const plugin = (factory as PluginFactory)(pluginConfig);
      const validation = validatePluginShape(plugin, expectedType);

      if (!validation.valid) {
        throw new PluginLoadError(shortName, validation.errors.join(', '));
      }

      return plugin as VersoPlugin;
    } catch (err) {
      if (err instanceof PluginLoadError) throw err;
      throw new PluginLoadError(shortName, (err as Error).message);
    }
  }

  throw new PluginLoadError(shortName, `Package not found. Tried: ${candidates.join(', ')}`);
}

export async function loadAllPlugins(
  config: VersoConfig,
  projectRoot: string,
  resolver: PluginResolver = defaultResolver,
): Promise<LoadedPlugins> {
  const plugins: LoadedPlugins = {};
  const pluginsConfig = (config as unknown as Record<string, unknown>).plugins as Record<string, unknown> | undefined;
  if (!pluginsConfig) return plugins;

  for (const [type, shortName] of Object.entries(pluginsConfig)) {
    if (shortName && typeof shortName === 'string') {
      plugins[type as keyof LoadedPlugins] = await loadPlugin(
        shortName,
        type as PluginType,
        config as unknown as Record<string, unknown>,
        projectRoot,
        resolver,
      );
    }
  }

  return plugins;
}

export interface ApplySyncResult {
  applied: number;
  errors: string[];
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function applySyncActions(
  board: BoardFile,
  actions: SyncAction[],
  config?: VersoConfig,
): ApplySyncResult {
  let applied = 0;
  const errors: string[] = [];

  for (const action of actions) {
    try {
      switch (action.type) {
        case 'move': {
          const item = board.items.find(i => i.id === action.itemId);
          if (!item) {
            errors.push(`Item ${action.itemId} not found`);
            break;
          }
          if (!canTransition(item.state, action.to)) {
            errors.push(`Invalid transition for item ${action.itemId}: ${item.state} → ${action.to}`);
            break;
          }
          // WIP guard for sync (only when config is provided)
          if (config && (action.to === 'building' || action.to === 'pr_ready')) {
            const count = board.items.filter(i => i.state === action.to).length;
            const wipLimit = action.to === 'building' ? config.wip.building : config.wip.pr_ready;
            try {
              checkWipGuard(count, wipLimit, action.to);
            } catch {
              errors.push(`WIP limit reached for ${action.to} (${count}/${wipLimit}), skipping move for item ${action.itemId}`);
              break;
            }
          }
          const from = item.state;
          item.state = action.to;
          item.updated_at = nowIso();
          // Set blocked_reason when sync moves to blocked
          if (action.to === 'blocked') {
            item.blocked_reason = action.trigger || 'sync';
          } else if (from === 'blocked') {
            item.blocked_reason = '';
          }
          item.transitions.push({
            from,
            to: action.to,
            trigger: action.trigger,
            actor: 'sync',
            at: item.updated_at,
          });
          applied++;
          break;
        }
        case 'update': {
          const item = board.items.find(i => i.id === action.itemId);
          if (!item) {
            errors.push(`Item ${action.itemId} not found`);
            break;
          }
          // Filter dangerous fields that could bypass state machine
          const BLOCKED_FIELDS = new Set(['id', 'state', 'transitions', 'reviews', 'created_at']);
          const safeFields = Object.fromEntries(
            Object.entries(action.fields).filter(([key]) => !BLOCKED_FIELDS.has(key)),
          );
          Object.assign(item, safeFields);
          item.updated_at = nowIso();
          applied++;
          break;
        }
        case 'add': {
          const maxId = board.items.reduce((max, i) => Math.max(max, i.id), 0);
          const now = nowIso();
          const newItem = createDefaultItem({
            id: maxId + 1,
            title: action.title,
            type: action.workType,
            state: 'captured' as State,
            autonomy: 2,
            created_at: now,
            updated_at: now,
            external: action.external || {},
          });
          board.items.push(newItem);
          applied++;
          break;
        }
      }
    } catch (err) {
      errors.push(`Error applying action: ${(err as Error).message}`);
    }
  }

  return { applied, errors };
}
