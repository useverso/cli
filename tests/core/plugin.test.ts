import { describe, it, expect } from 'vitest';
import {
  resolvePackageName,
  createPluginContext,
  validatePluginShape,
  type SyncAction,
  type BoardPlugin,
  type ReviewPlugin,
  type PluginContext,
} from '../../src/core/plugin.js';
import { defaultConfig } from '../../src/core/config.js';

describe('resolvePackageName', () => {
  it('returns scoped and community variants', () => {
    const names = resolvePackageName('github');
    expect(names).toEqual(['@useverso/plugin-github', 'verso-plugin-github']);
  });
});

describe('createPluginContext', () => {
  it('returns correct shape', () => {
    const config = defaultConfig();
    const board = { schema_version: 1, items: [] };
    const ctx = createPluginContext('/tmp/.verso', config, board);
    expect(ctx.versoDir).toBe('/tmp/.verso');
    expect(ctx.config).toBe(config);
    expect(ctx.board).toBe(board);
  });
});

describe('validatePluginShape', () => {
  it('accepts valid board plugin mock', () => {
    const mock = {
      meta: { name: 'github', type: 'board', version: '1.0.0' },
      push: async () => ({ pushed: 0, actions: [], errors: [] }),
      pull: async () => [],
    };
    const result = validatePluginShape(mock, 'board');
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects board plugin missing push', () => {
    const mock = {
      meta: { name: 'github', type: 'board', version: '1.0.0' },
      pull: async () => [],
    };
    const result = validatePluginShape(mock, 'board');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Plugin missing required method: push');
  });

  it('accepts valid review plugin mock', () => {
    const mock = {
      meta: { name: 'github-review', type: 'review', version: '1.0.0' },
      onPrCreated: async () => ({
        id: '1',
        url: 'https://github.com/pr/1',
        state: 'open' as const,
        mergeable: true,
        checks: [],
      }),
      getPrStatus: async () => ({
        id: '1',
        url: 'https://github.com/pr/1',
        state: 'open' as const,
        mergeable: true,
        checks: [],
      }),
      mergePr: async () => ({ merged: true, sha: 'abc123' }),
    };
    const result = validatePluginShape(mock, 'review');
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects review plugin missing mergePr', () => {
    const mock = {
      meta: { name: 'github-review', type: 'review', version: '1.0.0' },
      onPrCreated: async () => ({}),
      getPrStatus: async () => ({}),
    };
    const result = validatePluginShape(mock, 'review');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Plugin missing required method: mergePr');
  });
});

describe('SyncAction', () => {
  it('type discrimination works for move, update, and add', () => {
    const actions: SyncAction[] = [
      { type: 'move', itemId: 1, to: 'building', trigger: 'start_build' },
      { type: 'update', itemId: 2, fields: { title: 'Updated title' } },
      { type: 'add', workType: 'bug', title: 'New bug' },
    ];

    const move = actions[0];
    if (move.type === 'move') {
      expect(move.to).toBe('building');
      expect(move.trigger).toBe('start_build');
    } else {
      throw new Error('Expected move action');
    }

    const update = actions[1];
    if (update.type === 'update') {
      expect(update.fields.title).toBe('Updated title');
    } else {
      throw new Error('Expected update action');
    }

    const add = actions[2];
    if (add.type === 'add') {
      expect(add.workType).toBe('bug');
      expect(add.title).toBe('New bug');
    } else {
      throw new Error('Expected add action');
    }
  });
});
