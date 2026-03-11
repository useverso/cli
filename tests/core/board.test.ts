import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  nextId,
  addItem,
  getItem,
  listItems,
  moveItem,
  updateItem,
  cancelItem,
  countInState,
  loadBoard,
  saveBoard,
  transitionItem,
} from '../../src/core/board.js';
import type { BoardFile } from '../../src/core/types.js';
import {
  InvalidTransitionError,
  ItemNotFoundError,
  WorkTypeRestrictionError,
  WipLimitReachedError,
  AutonomyApprovalRequiredError,
} from '../../src/core/error.js';
import { defaultConfig } from '../../src/core/config.js';

function emptyBoard(): BoardFile {
  return { schema_version: 1, items: [] };
}

// 1. nextId returns 1 for empty board
describe('nextId', () => {
  it('returns 1 for empty board', () => {
    expect(nextId(emptyBoard())).toBe(1);
  });

  // 2. nextId returns max+1 with gap ids
  it('returns max+1 with gap ids', () => {
    const board = emptyBoard();
    addItem(board, 'feature', 'A', 1);
    board.items[0].id = 1;
    addItem(board, 'bug', 'B', 1);
    board.items[1].id = 3;
    expect(nextId(board)).toBe(4);
  });
});

// 3. addItem auto-increments ID
describe('addItem', () => {
  it('auto-increments ID', () => {
    const board = emptyBoard();
    expect(addItem(board, 'feature', 'First', 2)).toBe(1);
    expect(addItem(board, 'bug', 'Second', 1)).toBe(2);
    expect(addItem(board, 'chore', 'Third', 3)).toBe(3);
  });

  // 4. sets state to captured
  it('sets state to captured', () => {
    const board = emptyBoard();
    const id = addItem(board, 'feature', 'Test', 2);
    expect(getItem(board, id)!.state).toBe('captured');
  });

  // 5. sets timestamps
  it('sets created_at and updated_at', () => {
    const board = emptyBoard();
    const id = addItem(board, 'feature', 'Test', 2);
    const item = getItem(board, id)!;
    expect(item.created_at).not.toBe('');
    expect(item.updated_at).not.toBe('');
    expect(item.created_at).toBe(item.updated_at);
  });

  // 6. sets retries and agent_sessions to 0
  it('sets retries and agent_sessions to 0', () => {
    const board = emptyBoard();
    const id = addItem(board, 'feature', 'Test', 2);
    const item = getItem(board, id)!;
    expect(item.retries).toBe(0);
    expect(item.agent_sessions).toBe(0);
  });
});

// 7-8. getItem
describe('getItem', () => {
  it('returns undefined for missing ID', () => {
    expect(getItem(emptyBoard(), 99)).toBeUndefined();
  });

  it('returns item for existing ID', () => {
    const board = emptyBoard();
    const id = addItem(board, 'feature', 'Test', 2);
    expect(getItem(board, id)!.title).toBe('Test');
  });
});

// 9-12. listItems
describe('listItems', () => {
  it('no filters returns all items', () => {
    const board = emptyBoard();
    addItem(board, 'feature', 'A', 1);
    addItem(board, 'bug', 'B', 2);
    addItem(board, 'chore', 'C', 3);
    expect(listItems(board)).toHaveLength(3);
  });

  it('filters by state', () => {
    const board = emptyBoard();
    addItem(board, 'feature', 'A', 1);
    addItem(board, 'bug', 'B', 2);
    moveItem(board, 1, 'refined', 'spec_written', 'pilot');

    const captured = listItems(board, 'captured');
    expect(captured).toHaveLength(1);
    expect(captured[0].title).toBe('B');

    const refined = listItems(board, 'refined');
    expect(refined).toHaveLength(1);
    expect(refined[0].title).toBe('A');
  });

  it('filters by work type', () => {
    const board = emptyBoard();
    addItem(board, 'feature', 'A', 1);
    addItem(board, 'bug', 'B', 2);
    addItem(board, 'feature', 'C', 1);

    expect(listItems(board, undefined, 'feature')).toHaveLength(2);
    expect(listItems(board, undefined, 'bug')).toHaveLength(1);
  });

  it('filters by both state and work type', () => {
    const board = emptyBoard();
    addItem(board, 'feature', 'A', 1);
    addItem(board, 'bug', 'B', 2);
    addItem(board, 'feature', 'C', 1);
    moveItem(board, 1, 'refined', 'spec_written', 'pilot');

    const capturedFeatures = listItems(board, 'captured', 'feature');
    expect(capturedFeatures).toHaveLength(1);
    expect(capturedFeatures[0].title).toBe('C');

    const refinedFeatures = listItems(board, 'refined', 'feature');
    expect(refinedFeatures).toHaveLength(1);
    expect(refinedFeatures[0].title).toBe('A');

    const capturedBugs = listItems(board, 'captured', 'bug');
    expect(capturedBugs).toHaveLength(1);
    expect(capturedBugs[0].title).toBe('B');
  });
});

// 13-16. moveItem
describe('moveItem', () => {
  it('valid transition succeeds', () => {
    const board = emptyBoard();
    addItem(board, 'feature', 'Test', 2);
    expect(() => moveItem(board, 1, 'refined', 'spec_written', 'pilot')).not.toThrow();
    expect(getItem(board, 1)!.state).toBe('refined');
  });

  it('invalid transition fails and state unchanged', () => {
    const board = emptyBoard();
    addItem(board, 'feature', 'Test', 2);
    expect(() => moveItem(board, 1, 'building', 'invalid', 'pilot')).toThrow(
      InvalidTransitionError,
    );
    expect(getItem(board, 1)!.state).toBe('captured');
  });

  it('appends to transitions history', () => {
    const board = emptyBoard();
    addItem(board, 'feature', 'Test', 2);
    moveItem(board, 1, 'refined', 'spec_written', 'pilot');

    const item = getItem(board, 1)!;
    expect(item.transitions).toHaveLength(1);
    expect(item.transitions[0].from).toBe('captured');
    expect(item.transitions[0].to).toBe('refined');
    expect(item.transitions[0].trigger).toBe('spec_written');
    expect(item.transitions[0].actor).toBe('pilot');
    expect(item.transitions[0].at).not.toBe('');
  });

  it('updates updated_at', () => {
    const board = emptyBoard();
    addItem(board, 'feature', 'Test', 2);
    const original = getItem(board, 1)!.updated_at;
    moveItem(board, 1, 'refined', 'spec_written', 'pilot');
    const item = getItem(board, 1)!;
    expect(item.updated_at).not.toBe('');
    expect(item.updated_at >= original).toBe(true);
  });
});

// 17-19. updateItem
describe('updateItem', () => {
  it('changes title', () => {
    const board = emptyBoard();
    addItem(board, 'feature', 'Old title', 2);
    updateItem(board, 1, { title: 'New title' });
    expect(getItem(board, 1)!.title).toBe('New title');
  });

  it('changes assignee', () => {
    const board = emptyBoard();
    addItem(board, 'feature', 'Test', 2);
    updateItem(board, 1, { assignee: 'builder' });
    expect(getItem(board, 1)!.assignee).toBe('builder');
  });

  it('returns ItemNotFoundError for missing id', () => {
    const board = emptyBoard();
    expect(() => updateItem(board, 99, { title: 'title' })).toThrow(ItemNotFoundError);
    try {
      updateItem(board, 99, { title: 'title' });
    } catch (e) {
      expect((e as ItemNotFoundError).id).toBe(99);
    }
  });
});

// 20-22. cancelItem
describe('cancelItem', () => {
  it('moves to cancelled', () => {
    const board = emptyBoard();
    addItem(board, 'feature', 'Test', 2);
    cancelItem(board, 1, 'rejected_or_duplicate');
    expect(getItem(board, 1)!.state).toBe('cancelled');
  });

  it('records reason in transition trigger', () => {
    const board = emptyBoard();
    addItem(board, 'feature', 'Test', 2);
    cancelItem(board, 1, 'duplicate_issue');
    const item = getItem(board, 1)!;
    expect(item.transitions).toHaveLength(1);
    expect(item.transitions[0].trigger).toBe('duplicate_issue');
  });

  it('already cancelled item fails', () => {
    const board = emptyBoard();
    addItem(board, 'feature', 'Test', 2);
    cancelItem(board, 1, 'rejected_or_duplicate');
    expect(() => cancelItem(board, 1, 'again')).toThrow();
  });
});

// 23. countInState
describe('countInState', () => {
  it('returns correct counts', () => {
    const board = emptyBoard();
    addItem(board, 'feature', 'A', 1);
    addItem(board, 'bug', 'B', 2);
    addItem(board, 'chore', 'C', 3);
    expect(countInState(board, 'captured')).toBe(3);
    expect(countInState(board, 'building')).toBe(0);

    moveItem(board, 1, 'refined', 'spec_written', 'pilot');
    expect(countInState(board, 'captured')).toBe(2);
    expect(countInState(board, 'refined')).toBe(1);
  });
});

// moveItem blocked_reason
describe('moveItem blocked_reason', () => {
  it('throws when moving to blocked without reason', () => {
    const b = emptyBoard();
    addItem(b, 'feature', 'Test', 2);
    moveItem(b, 1, 'refined', 'spec_written', 'pilot');
    moveItem(b, 1, 'queued', 'breakdown_complete', 'pilot');
    expect(() => moveItem(b, 1, 'blocked', 'blocked_by_external', 'pilot')).toThrow('blocked_reason');
  });

  it('succeeds with blocked_reason and records it', () => {
    const b = emptyBoard();
    addItem(b, 'feature', 'Test', 2);
    moveItem(b, 1, 'refined', 'spec_written', 'pilot');
    moveItem(b, 1, 'queued', 'breakdown_complete', 'pilot');
    moveItem(b, 1, 'blocked', 'blocked_by_external', 'pilot', { blocked_reason: 'waiting on API' });
    expect(getItem(b, 1)!.state).toBe('blocked');
    expect(getItem(b, 1)!.blocked_reason).toBe('waiting on API');
  });

  it('clears blocked_reason when leaving blocked state', () => {
    const b = emptyBoard();
    addItem(b, 'feature', 'Test', 2);
    moveItem(b, 1, 'refined', 'spec_written', 'pilot');
    moveItem(b, 1, 'queued', 'breakdown_complete', 'pilot');
    moveItem(b, 1, 'blocked', 'blocked_by_external', 'pilot', { blocked_reason: 'waiting' });
    moveItem(b, 1, 'queued', 'blocker_resolved', 'pilot');
    expect(getItem(b, 1)!.blocked_reason).toBe('');
  });
});

// updateItem expanded fields
describe('updateItem expanded fields', () => {
  it('updates description', () => {
    const b = emptyBoard();
    addItem(b, 'feature', 'Test', 2);
    updateItem(b, 1, { description: 'New desc' });
    expect(getItem(b, 1)!.description).toBe('New desc');
  });

  it('updates milestone', () => {
    const b = emptyBoard();
    addItem(b, 'feature', 'Test', 2);
    updateItem(b, 1, { milestone: 'v1.0' });
    expect(getItem(b, 1)!.milestone).toBe('v1.0');
  });

  it('updates complexity', () => {
    const b = emptyBoard();
    addItem(b, 'feature', 'Test', 2);
    updateItem(b, 1, { complexity: 'complex' });
    expect(getItem(b, 1)!.complexity).toBe('complex');
  });

  it('updates spec_path', () => {
    const b = emptyBoard();
    addItem(b, 'feature', 'Test', 2);
    updateItem(b, 1, { spec_path: '.verso/specs/001.md' });
    expect(getItem(b, 1)!.spec_path).toBe('.verso/specs/001.md');
  });

  it('updates labels', () => {
    const b = emptyBoard();
    addItem(b, 'feature', 'Test', 2);
    updateItem(b, 1, { labels: ['auth', 'security'] });
    expect(getItem(b, 1)!.labels).toEqual(['auth', 'security']);
  });

  it('updates branch and pr', () => {
    const b = emptyBoard();
    addItem(b, 'feature', 'Test', 2);
    updateItem(b, 1, { branch: 'feat/auth', pr: '#42' });
    expect(getItem(b, 1)!.branch).toBe('feat/auth');
    expect(getItem(b, 1)!.pr).toBe('#42');
  });

  it('updates autonomy', () => {
    const b = emptyBoard();
    addItem(b, 'feature', 'Test', 2);
    updateItem(b, 1, { autonomy: 4 });
    expect(getItem(b, 1)!.autonomy).toBe(4);
  });

  it('updates blocked_reason', () => {
    const b = emptyBoard();
    addItem(b, 'feature', 'Test', 2);
    updateItem(b, 1, { blocked_reason: 'new reason' });
    expect(getItem(b, 1)!.blocked_reason).toBe('new reason');
  });
});

// addItem with options
describe('addItem with options', () => {
  it('accepts description', () => {
    const b = emptyBoard();
    const id = addItem(b, 'feature', 'Test', 2, { description: 'A desc' });
    expect(getItem(b, id)!.description).toBe('A desc');
  });

  it('accepts milestone and labels', () => {
    const b = emptyBoard();
    const id = addItem(b, 'feature', 'Test', 2, { milestone: 'v1', labels: ['core'] });
    expect(getItem(b, id)!.milestone).toBe('v1');
    expect(getItem(b, id)!.labels).toEqual(['core']);
  });
});

// 24-25. save/load roundtrip
describe('save/load board', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verso-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('roundtrip preserves all data', () => {
    const board = emptyBoard();
    addItem(board, 'feature', 'Roundtrip test', 2);
    moveItem(board, 1, 'refined', 'spec_written', 'pilot');

    saveBoard(tmpDir, board);
    expect(fs.existsSync(path.join(tmpDir, 'board.yaml'))).toBe(true);

    const loaded = loadBoard(tmpDir);
    expect(loaded.schema_version).toBe(board.schema_version);
    expect(loaded.items).toHaveLength(board.items.length);
    expect(loaded.items[0].id).toBe(1);
    expect(loaded.items[0].title).toBe('Roundtrip test');
    expect(loaded.items[0].state).toBe('refined');
    expect(loaded.items[0].transitions).toHaveLength(1);
  });

  it('load from missing file returns default empty board', () => {
    const board = loadBoard(tmpDir);
    expect(board.schema_version).toBe(2);
    expect(board.items).toEqual([]);
  });
});

// --- transitionItem integration tests ---
describe('transitionItem', () => {
  it('performs valid transition with guards passing', () => {
    const board = emptyBoard();
    const config = defaultConfig();
    config.autonomy.feature = 4;
    addItem(board, 'feature', 'Test', 2);
    transitionItem(board, 1, 'refined', 'spec_written', 'captain', config);
    expect(getItem(board, 1)!.state).toBe('refined');
    expect(getItem(board, 1)!.transitions).toHaveLength(1);
  });

  it('throws ItemNotFoundError for missing id', () => {
    const board = emptyBoard();
    const config = defaultConfig();
    expect(() => transitionItem(board, 99, 'refined', 'spec_written', 'captain', config)).toThrow(ItemNotFoundError);
  });

  it('enforces work type restriction via guards', () => {
    const board = emptyBoard();
    const config = defaultConfig();
    addItem(board, 'feature', 'Test', 2);
    expect(() => transitionItem(board, 1, 'queued', 'simple_work', 'captain', config)).toThrow(WorkTypeRestrictionError);
    expect(getItem(board, 1)!.state).toBe('captured');
  });

  it('enforces WIP limit via guards', () => {
    const board = emptyBoard();
    const config = defaultConfig();
    config.wip.building = 1;
    config.autonomy.feature = 4;
    // Add an item already in building
    addItem(board, 'feature', 'Existing', 2);
    moveItem(board, 1, 'refined', 'spec_written', 'pilot');
    moveItem(board, 1, 'queued', 'breakdown_complete', 'pilot');
    moveItem(board, 1, 'building', 'builder_spawned', 'pilot');
    // Add second item in queued
    addItem(board, 'feature', 'New', 2);
    moveItem(board, 2, 'refined', 'spec_written', 'pilot');
    moveItem(board, 2, 'queued', 'breakdown_complete', 'pilot');
    expect(() => transitionItem(board, 2, 'building', 'builder_spawned', 'captain', config)).toThrow(WipLimitReachedError);
    expect(getItem(board, 2)!.state).toBe('queued');
  });

  it('enforces autonomy approval via guards', () => {
    const board = emptyBoard();
    const config = defaultConfig();
    config.autonomy.feature = 2;
    addItem(board, 'feature', 'Test', 2);
    expect(() => transitionItem(board, 1, 'refined', 'spec_written', 'pilot', config)).toThrow(AutonomyApprovalRequiredError);
    expect(getItem(board, 1)!.state).toBe('captured');
  });
});
