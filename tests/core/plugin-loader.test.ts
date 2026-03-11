import { describe, it, expect } from 'vitest';
import {
  loadPlugin,
  loadAllPlugins,
  applySyncActions,
  type PluginResolver,
} from '../../src/core/plugin-loader.js';
import { PluginLoadError } from '../../src/core/error.js';
import type { BoardFile, State } from '../../src/core/types.js';
import { createDefaultItem } from '../../src/core/types.js';
import { defaultConfig } from '../../src/core/config.js';

// --- Mock helpers ---

function createMockBoardPlugin() {
  return {
    meta: { name: 'test-board', type: 'board', version: '1.0.0' },
    push: async () => ({ pushed: 0, actions: [], errors: [] }),
    pull: async () => [],
  };
}

function createMockReviewPlugin() {
  return {
    meta: { name: 'test-review', type: 'review', version: '1.0.0' },
    onPrCreated: async () => ({
      id: '1',
      url: '',
      state: 'open' as const,
      mergeable: true,
      checks: [],
    }),
    getPrStatus: async () => ({
      id: '1',
      url: '',
      state: 'open' as const,
      mergeable: true,
      checks: [],
    }),
    mergePr: async () => ({ merged: true }),
  };
}

function mockResolver(plugins: Record<string, unknown>): PluginResolver {
  return async (name: string) => {
    if (name in plugins) {
      const value = plugins[name];
      // If already an object with explicit exports, return as-is
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
      return { default: value };
    }
    throw new Error(`Cannot find module '${name}'`);
  };
}

function createTestBoard(items: Array<{ id: number; state: State; title?: string }>): BoardFile {
  return {
    schema_version: 1,
    items: items.map(({ id, state, title }) =>
      createDefaultItem({ id, state, title: title || `Item ${id}` }),
    ),
  };
}

// --- Tests ---

describe('loadPlugin', () => {
  it('throws PluginLoadError when package not found', async () => {
    const resolver = mockResolver({});
    await expect(
      loadPlugin('nonexistent', 'board', {}, '/tmp', resolver),
    ).rejects.toThrow(PluginLoadError);
    await expect(
      loadPlugin('nonexistent', 'board', {}, '/tmp', resolver),
    ).rejects.toThrow('Package not found');
  });

  it('throws when default export is not a function', async () => {
    const resolver = mockResolver({
      '@useverso/plugin-bad': 'not-a-function',
    });
    await expect(
      loadPlugin('bad', 'board', {}, '/tmp', resolver),
    ).rejects.toThrow(PluginLoadError);
    await expect(
      loadPlugin('bad', 'board', {}, '/tmp', resolver),
    ).rejects.toThrow('No "board" export or default export found');
  });

  it('throws when plugin type mismatches expected type', async () => {
    const factory = () => createMockBoardPlugin(); // type is 'board'
    const resolver = mockResolver({
      '@useverso/plugin-wrong': factory,
    });
    await expect(
      loadPlugin('wrong', 'review', {}, '/tmp', resolver), // expecting 'review'
    ).rejects.toThrow(PluginLoadError);
    await expect(
      loadPlugin('wrong', 'review', {}, '/tmp', resolver),
    ).rejects.toThrow('does not match expected');
  });

  it('succeeds with valid mock board plugin', async () => {
    const factory = () => createMockBoardPlugin();
    const resolver = mockResolver({
      '@useverso/plugin-github': factory,
    });
    const plugin = await loadPlugin('github', 'board', {}, '/tmp', resolver);
    expect(plugin.meta.name).toBe('test-board');
    expect(plugin.meta.type).toBe('board');
  });
});

describe('loadAllPlugins', () => {
  it('returns empty result with no plugins configured', async () => {
    const config = defaultConfig();
    const resolver = mockResolver({});
    const plugins = await loadAllPlugins(config, '/tmp', resolver);
    expect(plugins).toEqual({});
  });

  it('loads board and review when configured', async () => {
    const config = {
      ...defaultConfig(),
      plugins: { board: 'github', review: 'github-review' },
    } as any;

    const boardFactory = () => createMockBoardPlugin();
    const reviewFactory = () => createMockReviewPlugin();

    const resolver = mockResolver({
      '@useverso/plugin-github': boardFactory,
      '@useverso/plugin-github-review': reviewFactory,
    });

    const plugins = await loadAllPlugins(config, '/tmp', resolver);
    expect(plugins.board).toBeDefined();
    expect(plugins.board!.meta.type).toBe('board');
    expect(plugins.review).toBeDefined();
    expect(plugins.review!.meta.type).toBe('review');
  });
});

describe('applySyncActions', () => {
  it('move action succeeds for valid transition (captured → refined)', () => {
    const board = createTestBoard([{ id: 1, state: 'captured' }]);
    const result = applySyncActions(board, [
      { type: 'move', itemId: 1, to: 'refined', trigger: 'spec_written' },
    ]);
    expect(result.applied).toBe(1);
    expect(result.errors).toEqual([]);
    expect(board.items[0].state).toBe('refined');
    expect(board.items[0].transitions).toHaveLength(1);
    expect(board.items[0].transitions[0].from).toBe('captured');
    expect(board.items[0].transitions[0].to).toBe('refined');
  });

  it('move action returns error for invalid transition (captured → done)', () => {
    const board = createTestBoard([{ id: 1, state: 'captured' }]);
    const result = applySyncActions(board, [
      { type: 'move', itemId: 1, to: 'done', trigger: 'skip' },
    ]);
    expect(result.applied).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Invalid transition');
    expect(board.items[0].state).toBe('captured');
  });

  it('update action merges fields into item', () => {
    const board = createTestBoard([{ id: 1, state: 'captured', title: 'Original' }]);
    const result = applySyncActions(board, [
      { type: 'update', itemId: 1, fields: { title: 'Updated', assignee: 'dev1' } },
    ]);
    expect(result.applied).toBe(1);
    expect(result.errors).toEqual([]);
    expect(board.items[0].title).toBe('Updated');
    expect(board.items[0].assignee).toBe('dev1');
  });

  it('add action creates a new item', () => {
    const board = createTestBoard([{ id: 1, state: 'captured' }]);
    const result = applySyncActions(board, [
      { type: 'add', workType: 'bug', title: 'New bug from sync' },
    ]);
    expect(result.applied).toBe(1);
    expect(result.errors).toEqual([]);
    expect(board.items).toHaveLength(2);
    const newItem = board.items[1];
    expect(newItem.id).toBe(2);
    expect(newItem.title).toBe('New bug from sync');
    expect(newItem.type).toBe('bug');
    expect(newItem.state).toBe('captured');
  });

  it('multiple actions are applied in order', () => {
    const board = createTestBoard([
      { id: 1, state: 'captured' },
      { id: 2, state: 'refined' },
    ]);
    const result = applySyncActions(board, [
      { type: 'move', itemId: 1, to: 'refined', trigger: 'spec_written' },
      { type: 'update', itemId: 2, fields: { assignee: 'pilot' } },
      { type: 'add', workType: 'feature', title: 'Third item' },
      { type: 'move', itemId: 2, to: 'queued', trigger: 'breakdown_complete' },
    ]);
    expect(result.applied).toBe(4);
    expect(result.errors).toEqual([]);
    expect(board.items[0].state).toBe('refined');
    expect(board.items[1].assignee).toBe('pilot');
    expect(board.items[1].state).toBe('queued');
    expect(board.items).toHaveLength(3);
    expect(board.items[2].title).toBe('Third item');
  });
});

describe('applySyncActions update field filtering', () => {
  it('update action cannot overwrite state', () => {
    const board = createTestBoard([{ id: 1, state: 'captured' }]);
    const result = applySyncActions(board, [
      { type: 'update', itemId: 1, fields: { state: 'done' as any, title: 'New title' } },
    ]);
    expect(result.applied).toBe(1);
    expect(board.items[0].state).toBe('captured');
    expect(board.items[0].title).toBe('New title');
  });

  it('update action cannot overwrite id', () => {
    const board = createTestBoard([{ id: 1, state: 'captured' }]);
    applySyncActions(board, [
      { type: 'update', itemId: 1, fields: { id: 999 } as any },
    ]);
    expect(board.items[0].id).toBe(1);
  });

  it('update action cannot overwrite transitions', () => {
    const board = createTestBoard([{ id: 1, state: 'captured' }]);
    applySyncActions(board, [
      { type: 'update', itemId: 1, fields: { transitions: [{}] } as any },
    ]);
    expect(board.items[0].transitions).toEqual([]);
  });

  it('update action cannot overwrite reviews', () => {
    const board = createTestBoard([{ id: 1, state: 'captured' }]);
    applySyncActions(board, [
      { type: 'update', itemId: 1, fields: { reviews: [{}] } as any },
    ]);
    expect(board.items[0].reviews).toEqual([]);
  });

  it('update action cannot overwrite created_at', () => {
    const board = createTestBoard([{ id: 1, state: 'captured' }]);
    board.items[0].created_at = '2026-01-01T00:00:00Z';
    applySyncActions(board, [
      { type: 'update', itemId: 1, fields: { created_at: '1999-01-01T00:00:00Z' } as any },
    ]);
    expect(board.items[0].created_at).toBe('2026-01-01T00:00:00Z');
  });

  it('update action allows safe fields like description and milestone', () => {
    const board = createTestBoard([{ id: 1, state: 'captured' }]);
    applySyncActions(board, [
      { type: 'update', itemId: 1, fields: { description: 'From sync', milestone: 'v1.0' } as any },
    ]);
    expect(board.items[0].description).toBe('From sync');
    expect(board.items[0].milestone).toBe('v1.0');
  });
});

describe('applySyncActions blocked_reason and add defaults', () => {
  it('move to blocked via sync sets blocked_reason from trigger', () => {
    const board = createTestBoard([{ id: 1, state: 'queued' }]);
    const result = applySyncActions(board, [
      { type: 'move', itemId: 1, to: 'blocked', trigger: 'blocked_by_external' },
    ]);
    expect(result.applied).toBe(1);
    expect(board.items[0].blocked_reason).toBe('blocked_by_external');
  });

  it('add action creates item with all default fields including new ones', () => {
    const board = createTestBoard([]);
    const result = applySyncActions(board, [
      { type: 'add', workType: 'feature', title: 'Synced item' },
    ]);
    expect(result.applied).toBe(1);
    const item = board.items[0];
    expect(item.description).toBe('');
    expect(item.milestone).toBe('');
    expect(item.blocked_by).toEqual([]);
    expect(item.costs).toBeDefined();
    expect(item.costs.tokens_in).toBe(0);
  });
});

describe('applySyncActions WIP guard with config', () => {
  function configWithWip(building: number, prReady: number) {
    const config = defaultConfig();
    config.wip.building = building;
    config.wip.pr_ready = prReady;
    return config;
  }

  it('sync move to building respects WIP limit', () => {
    const board = createTestBoard([
      { id: 1, state: 'building' },
      { id: 2, state: 'queued' },
    ]);
    const config = configWithWip(1, 5); // building WIP = 1, already 1 item building
    const result = applySyncActions(board, [
      { type: 'move', itemId: 2, to: 'building', trigger: 'builder_spawned' },
    ], config);
    expect(result.applied).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('WIP limit reached for building');
    expect(board.items[1].state).toBe('queued'); // not moved
  });

  it('sync move to pr_ready respects WIP limit', () => {
    const board = createTestBoard([
      { id: 1, state: 'pr_ready' },
      { id: 2, state: 'pr_ready' },
      { id: 3, state: 'building' },
    ]);
    const config = configWithWip(5, 2); // pr_ready WIP = 2, already 2 items
    const result = applySyncActions(board, [
      { type: 'move', itemId: 3, to: 'pr_ready', trigger: 'review_skipped' },
    ], config);
    expect(result.applied).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('WIP limit reached for pr_ready');
    expect(board.items[2].state).toBe('building');
  });

  it('sync to other states works without config', () => {
    const board = createTestBoard([{ id: 1, state: 'captured' }]);
    const result = applySyncActions(board, [
      { type: 'move', itemId: 1, to: 'refined', trigger: 'spec_written' },
    ]);
    expect(result.applied).toBe(1);
    expect(result.errors).toEqual([]);
    expect(board.items[0].state).toBe('refined');
  });

  it('sync with config but under WIP limit succeeds', () => {
    const board = createTestBoard([{ id: 1, state: 'queued' }]);
    const config = configWithWip(3, 5); // plenty of room
    const result = applySyncActions(board, [
      { type: 'move', itemId: 1, to: 'building', trigger: 'builder_spawned' },
    ], config);
    expect(result.applied).toBe(1);
    expect(result.errors).toEqual([]);
    expect(board.items[0].state).toBe('building');
  });

  it('sync skips action (does not throw) when WIP exceeded', () => {
    const board = createTestBoard([
      { id: 1, state: 'building' },
      { id: 2, state: 'building' },
      { id: 3, state: 'queued' },
      { id: 4, state: 'captured' },
    ]);
    const config = configWithWip(2, 5);
    // Should not throw, should skip the WIP-exceeding move and continue
    const result = applySyncActions(board, [
      { type: 'move', itemId: 3, to: 'building', trigger: 'builder_spawned' },
      { type: 'move', itemId: 4, to: 'refined', trigger: 'spec_written' },
    ], config);
    expect(result.applied).toBe(1); // only the second move succeeds
    expect(result.errors).toHaveLength(1);
    expect(board.items[2].state).toBe('queued'); // skipped
    expect(board.items[3].state).toBe('refined'); // applied
  });

  it('sync without config parameter works as before (backward compatible)', () => {
    const board = createTestBoard([
      { id: 1, state: 'building' },
      { id: 2, state: 'building' },
      { id: 3, state: 'queued' },
    ]);
    // No config — WIP check should NOT happen
    const result = applySyncActions(board, [
      { type: 'move', itemId: 3, to: 'building', trigger: 'builder_spawned' },
    ]);
    expect(result.applied).toBe(1);
    expect(result.errors).toEqual([]);
    expect(board.items[2].state).toBe('building'); // moved despite WIP
  });
});

describe('named exports', () => {
  it('loadPlugin resolves named export matching type', async () => {
    const boardFactory = () => createMockBoardPlugin();
    const resolver = mockResolver({
      '@useverso/plugin-github': { board: boardFactory },
    });
    const plugin = await loadPlugin('github', 'board', {}, '/tmp', resolver);
    expect(plugin.meta.type).toBe('board');
  });

  it('loadPlugin falls back to default when no named export', async () => {
    const factory = () => createMockBoardPlugin();
    const resolver = mockResolver({
      '@useverso/plugin-github': { default: factory },
    });
    const plugin = await loadPlugin('github', 'board', {}, '/tmp', resolver);
    expect(plugin.meta.type).toBe('board');
  });

  it('loadPlugin from same package for different types returns different plugins', async () => {
    const boardFactory = () => createMockBoardPlugin();
    const reviewFactory = () => createMockReviewPlugin();
    const resolver: PluginResolver = async (name) => {
      if (name === '@useverso/plugin-github') {
        return { board: boardFactory, review: reviewFactory };
      }
      throw new Error('not found');
    };

    const boardPlugin = await loadPlugin('github', 'board', {}, '/tmp', resolver);
    const reviewPlugin = await loadPlugin('github', 'review', {}, '/tmp', resolver);
    expect(boardPlugin.meta.type).toBe('board');
    expect(reviewPlugin.meta.type).toBe('review');
  });
});
