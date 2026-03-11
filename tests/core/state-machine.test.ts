import { describe, expect, it } from 'vitest';
import {
  validateTransition,
  validTransitions,
  canTransition,
  isTerminal,
  checkWipGuard,
  checkRetryGuard,
  checkReviewRoundsGuard,
  checkTransitionGuards,
} from '../../src/core/state-machine.js';
import type { GuardContext } from '../../src/core/state-machine.js';
import type { State } from '../../src/core/types.js';
import { ALL_STATES, createDefaultItem } from '../../src/core/types.js';
import type { BoardFile } from '../../src/core/types.js';
import {
  InvalidTransitionError,
  WipLimitReachedError,
  MaxRetriesExceededError,
  MaxReviewRoundsExceededError,
  WorkTypeRestrictionError,
  AutonomyApprovalRequiredError,
} from '../../src/core/error.js';
import { defaultConfig } from '../../src/core/config.js';
import type { VersoConfig } from '../../src/core/config.js';

// --- 1-15. All 15 valid transitions return correct trigger name ---
describe('valid transitions', () => {
  const cases: Array<[State, State, string]> = [
    ['captured', 'refined', 'spec_written'],
    ['captured', 'queued', 'simple_work'],
    ['captured', 'cancelled', 'rejected_or_duplicate'],
    ['refined', 'queued', 'breakdown_complete'],
    ['queued', 'building', 'builder_spawned'],
    ['queued', 'blocked', 'blocked_by_external'],
    ['building', 'verifying', 'pr_created'],
    ['building', 'queued', 'build_failed'],
    ['building', 'blocked', 'blocked_by_external'],
    ['building', 'pr_ready', 'review_skipped'],
    ['verifying', 'pr_ready', 'reviewer_commented'],
    ['verifying', 'building', 'issues_found'],
    ['verifying', 'blocked', 'blocked_by_external'],
    ['blocked', 'queued', 'blocker_resolved'],
    ['pr_ready', 'done', 'pr_merged'],
    ['pr_ready', 'building', 'dev_requested_changes'],
  ];

  for (const [from, to, trigger] of cases) {
    it(`${from} -> ${to} returns "${trigger}"`, () => {
      expect(validateTransition(from, to)).toBe(trigger);
    });
  }
});

// --- Invalid transitions ---
describe('invalid transitions', () => {
  it('captured -> building is invalid', () => {
    expect(() => validateTransition('captured', 'building')).toThrow(InvalidTransitionError);
    try {
      validateTransition('captured', 'building');
    } catch (e) {
      const err = e as InvalidTransitionError;
      expect(err.from).toBe('captured');
      expect(err.to).toBe('building');
      expect(err.validTargets).toHaveLength(3);
    }
  });

  it('done -> captured is invalid (terminal state)', () => {
    expect(() => validateTransition('done', 'captured')).toThrow(InvalidTransitionError);
  });

  it('cancelled -> anything is invalid', () => {
    for (const target of ALL_STATES) {
      expect(() => validateTransition('cancelled', target)).toThrow(InvalidTransitionError);
    }
  });
});

// --- validTransitions ---
describe('validTransitions', () => {
  it('captured returns 3 entries', () => {
    const targets = validTransitions('captured');
    expect(targets).toHaveLength(3);
    expect(targets[0]).toEqual({ to: 'refined', trigger: 'spec_written' });
    expect(targets[1]).toEqual({ to: 'queued', trigger: 'simple_work' });
    expect(targets[2]).toEqual({ to: 'cancelled', trigger: 'rejected_or_duplicate' });
  });

  it('done returns empty', () => {
    expect(validTransitions('done')).toHaveLength(0);
  });

  it('cancelled returns empty', () => {
    expect(validTransitions('cancelled')).toHaveLength(0);
  });
});

// --- canTransition ---
describe('canTransition', () => {
  it('returns true for valid transitions', () => {
    expect(canTransition('captured', 'refined')).toBe(true);
    expect(canTransition('pr_ready', 'done')).toBe(true);
  });

  it('returns false for invalid transitions', () => {
    expect(canTransition('captured', 'building')).toBe(false);
    expect(canTransition('done', 'captured')).toBe(false);
  });
});

// --- Guards ---
describe('checkWipGuard', () => {
  it('fails at capacity', () => {
    expect(() => checkWipGuard(2, 2)).toThrow(WipLimitReachedError);
    try {
      checkWipGuard(2, 2);
    } catch (e) {
      const err = e as WipLimitReachedError;
      expect(err.message).toContain('WIP limit reached');
      expect(err.message).toContain('2/2');
    }
  });

  it('succeeds under limit', () => {
    expect(() => checkWipGuard(1, 2)).not.toThrow();
  });

  it('uses state parameter for error message', () => {
    try {
      checkWipGuard(5, 5, 'pr_ready');
    } catch (e) {
      const err = e as WipLimitReachedError;
      expect(err.state).toBe('pr_ready');
    }
  });

  it('defaults state to building', () => {
    try {
      checkWipGuard(2, 2);
    } catch (e) {
      const err = e as WipLimitReachedError;
      expect(err.state).toBe('building');
    }
  });
});

describe('checkRetryGuard', () => {
  it('fails at max', () => {
    expect(() => checkRetryGuard(1, 3, 3)).toThrow(MaxRetriesExceededError);
    try {
      checkRetryGuard(1, 3, 3);
    } catch (e) {
      const err = e as MaxRetriesExceededError;
      expect(err.itemId).toBe(1);
      expect(err.retries).toBe(3);
    }
  });

  it('succeeds under max', () => {
    expect(() => checkRetryGuard(1, 2, 3)).not.toThrow();
  });
});

describe('checkReviewRoundsGuard', () => {
  it('fails at max', () => {
    expect(() => checkReviewRoundsGuard(1, 3, 3)).toThrow(MaxReviewRoundsExceededError);
    try {
      checkReviewRoundsGuard(1, 3, 3);
    } catch (e) {
      const err = e as MaxReviewRoundsExceededError;
      expect(err.itemId).toBe(1);
      expect(err.rounds).toBe(3);
    }
  });

  it('succeeds under max', () => {
    expect(() => checkReviewRoundsGuard(1, 2, 3)).not.toThrow();
  });
});

// --- terminal state enforcement ---
describe('terminal state enforcement', () => {
  it('validateTransition from done gives terminal state message', () => {
    expect(() => validateTransition('done', 'captured')).toThrow('terminal state');
  });

  it('validateTransition from cancelled gives terminal state message', () => {
    expect(() => validateTransition('cancelled', 'queued')).toThrow('terminal state');
  });

  it('max_retries_exceeded is valid trigger for building to blocked', () => {
    expect(canTransition('building', 'blocked')).toBe(true);
  });
});

// --- isTerminal ---
describe('isTerminal', () => {
  it('done and cancelled are terminal', () => {
    expect(isTerminal('done')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
  });

  it('non-terminal states return false', () => {
    const nonTerminal: State[] = [
      'captured',
      'refined',
      'queued',
      'blocked',
      'building',
      'verifying',
      'pr_ready',
    ];
    for (const state of nonTerminal) {
      expect(isTerminal(state)).toBe(false);
    }
  });
});

// --- new transition: building -> pr_ready (review_skipped) ---
describe('review_skipped transition', () => {
  it('building -> pr_ready is valid', () => {
    expect(canTransition('building', 'pr_ready')).toBe(true);
  });

  it('validateTransition returns review_skipped trigger', () => {
    expect(validateTransition('building', 'pr_ready')).toBe('review_skipped');
  });

  it('building now has 5 valid targets', () => {
    const targets = validTransitions('building');
    expect(targets.length).toBe(5);
  });
});

// --- checkTransitionGuards ---
function makeCtx(overrides: Partial<GuardContext> = {}): GuardContext {
  const config = defaultConfig();
  const item = createDefaultItem({ id: 1, type: 'feature', state: 'captured' });
  const board: BoardFile = { schema_version: 2, items: [item] };
  return {
    item,
    to: 'refined',
    trigger: 'spec_written',
    actor: 'captain',
    board,
    config,
    ...overrides,
  };
}

describe('checkTransitionGuards — WIP', () => {
  it('blocks transition to building when WIP limit reached', () => {
    const config = defaultConfig();
    config.wip.building = 1;
    const existingItem = createDefaultItem({ id: 2, state: 'building' });
    const item = createDefaultItem({ id: 1, state: 'queued', type: 'feature' });
    const board: BoardFile = { schema_version: 2, items: [existingItem, item] };
    expect(() =>
      checkTransitionGuards({ item, to: 'building', trigger: 'builder_spawned', actor: 'captain', board, config }),
    ).toThrow(WipLimitReachedError);
  });

  it('allows transition to building under WIP limit', () => {
    const config = defaultConfig();
    config.wip.building = 2;
    const item = createDefaultItem({ id: 1, state: 'queued', type: 'feature' });
    const board: BoardFile = { schema_version: 2, items: [item] };
    expect(() =>
      checkTransitionGuards({ item, to: 'building', trigger: 'builder_spawned', actor: 'captain', board, config }),
    ).not.toThrow();
  });

  it('blocks transition to pr_ready when WIP limit reached', () => {
    const config = defaultConfig();
    config.wip.pr_ready = 1;
    const existing = createDefaultItem({ id: 2, state: 'pr_ready' });
    const item = createDefaultItem({ id: 1, state: 'verifying', type: 'feature' });
    const board: BoardFile = { schema_version: 2, items: [existing, item] };
    expect(() =>
      checkTransitionGuards({ item, to: 'pr_ready', trigger: 'reviewer_commented', actor: 'captain', board, config }),
    ).toThrow(WipLimitReachedError);
  });
});

describe('checkTransitionGuards — work type restrictions', () => {
  it('allows simple_work for hotfix', () => {
    const ctx = makeCtx();
    ctx.item = createDefaultItem({ id: 1, state: 'captured', type: 'hotfix' });
    ctx.board.items = [ctx.item];
    ctx.to = 'queued';
    ctx.trigger = 'simple_work';
    expect(() => checkTransitionGuards(ctx)).not.toThrow();
  });

  it('allows simple_work for chore', () => {
    const ctx = makeCtx();
    ctx.item = createDefaultItem({ id: 1, state: 'captured', type: 'chore' });
    ctx.board.items = [ctx.item];
    ctx.to = 'queued';
    ctx.trigger = 'simple_work';
    expect(() => checkTransitionGuards(ctx)).not.toThrow();
  });

  it('blocks simple_work for feature', () => {
    const ctx = makeCtx();
    ctx.item = createDefaultItem({ id: 1, state: 'captured', type: 'feature' });
    ctx.board.items = [ctx.item];
    ctx.to = 'queued';
    ctx.trigger = 'simple_work';
    expect(() => checkTransitionGuards(ctx)).toThrow(WorkTypeRestrictionError);
  });

  it('blocks simple_work for bug', () => {
    const ctx = makeCtx();
    ctx.item = createDefaultItem({ id: 1, state: 'captured', type: 'bug' });
    ctx.board.items = [ctx.item];
    ctx.to = 'queued';
    ctx.trigger = 'simple_work';
    expect(() => checkTransitionGuards(ctx)).toThrow(WorkTypeRestrictionError);
  });

  it('allows review_skipped for chore', () => {
    const ctx = makeCtx();
    ctx.item = createDefaultItem({ id: 1, state: 'building', type: 'chore' });
    ctx.board.items = [ctx.item];
    ctx.to = 'pr_ready';
    ctx.trigger = 'review_skipped';
    expect(() => checkTransitionGuards(ctx)).not.toThrow();
  });

  it('blocks review_skipped for feature', () => {
    const ctx = makeCtx();
    ctx.item = createDefaultItem({ id: 1, state: 'building', type: 'feature' });
    ctx.board.items = [ctx.item];
    ctx.to = 'pr_ready';
    ctx.trigger = 'review_skipped';
    expect(() => checkTransitionGuards(ctx)).toThrow(WorkTypeRestrictionError);
  });
});

describe('checkTransitionGuards — autonomy approval', () => {
  it('captain always allowed regardless of autonomy level', () => {
    const config = defaultConfig();
    config.autonomy.feature = 1;
    const item = createDefaultItem({ id: 1, state: 'captured', type: 'feature' });
    const board: BoardFile = { schema_version: 2, items: [item] };
    expect(() =>
      checkTransitionGuards({ item, to: 'refined', trigger: 'spec_written', actor: 'captain', board, config }),
    ).not.toThrow();
  });

  it('blocks pilot on captured->refined at autonomy <= 2', () => {
    const config = defaultConfig();
    config.autonomy.feature = 2;
    const item = createDefaultItem({ id: 1, state: 'captured', type: 'feature' });
    const board: BoardFile = { schema_version: 2, items: [item] };
    expect(() =>
      checkTransitionGuards({ item, to: 'refined', trigger: 'spec_written', actor: 'pilot', board, config }),
    ).toThrow(AutonomyApprovalRequiredError);
  });

  it('blocks pilot on refined->queued at autonomy <= 2', () => {
    const config = defaultConfig();
    config.autonomy.feature = 1;
    const item = createDefaultItem({ id: 1, state: 'refined', type: 'feature' });
    const board: BoardFile = { schema_version: 2, items: [item] };
    expect(() =>
      checkTransitionGuards({ item, to: 'queued', trigger: 'breakdown_complete', actor: 'pilot', board, config }),
    ).toThrow(AutonomyApprovalRequiredError);
  });

  it('allows pilot on captured->refined at autonomy 3', () => {
    const config = defaultConfig();
    config.autonomy.feature = 3;
    const item = createDefaultItem({ id: 1, state: 'captured', type: 'feature' });
    const board: BoardFile = { schema_version: 2, items: [item] };
    expect(() =>
      checkTransitionGuards({ item, to: 'refined', trigger: 'spec_written', actor: 'pilot', board, config }),
    ).not.toThrow();
  });

  it('blocks pilot on pr_ready->done at autonomy <= 3', () => {
    const config = defaultConfig();
    config.autonomy.feature = 3;
    const item = createDefaultItem({ id: 1, state: 'pr_ready', type: 'feature' });
    const board: BoardFile = { schema_version: 2, items: [item] };
    expect(() =>
      checkTransitionGuards({ item, to: 'done', trigger: 'pr_merged', actor: 'pilot', board, config }),
    ).toThrow(AutonomyApprovalRequiredError);
  });

  it('allows pilot on pr_ready->done at autonomy 4', () => {
    const config = defaultConfig();
    config.autonomy.feature = 4;
    const item = createDefaultItem({ id: 1, state: 'pr_ready', type: 'feature' });
    const board: BoardFile = { schema_version: 2, items: [item] };
    expect(() =>
      checkTransitionGuards({ item, to: 'done', trigger: 'pr_merged', actor: 'pilot', board, config }),
    ).not.toThrow();
  });
});

describe('checkTransitionGuards — retry limit', () => {
  it('blocks build_failed when retries at max', () => {
    const config = defaultConfig();
    config.build.max_retries = 3;
    const item = createDefaultItem({ id: 1, state: 'building', type: 'feature', retries: 3 });
    const board: BoardFile = { schema_version: 2, items: [item] };
    expect(() =>
      checkTransitionGuards({ item, to: 'queued', trigger: 'build_failed', actor: 'pilot', board, config }),
    ).toThrow(MaxRetriesExceededError);
  });

  it('allows build_failed under max retries', () => {
    const config = defaultConfig();
    config.build.max_retries = 3;
    const item = createDefaultItem({ id: 1, state: 'building', type: 'feature', retries: 2 });
    const board: BoardFile = { schema_version: 2, items: [item] };
    expect(() =>
      checkTransitionGuards({ item, to: 'queued', trigger: 'build_failed', actor: 'pilot', board, config }),
    ).not.toThrow();
  });
});

describe('checkTransitionGuards — review rounds', () => {
  it('blocks issues_found when review rounds at max', () => {
    const config = defaultConfig();
    config.review.max_rounds = 2;
    const item = createDefaultItem({ id: 1, state: 'verifying', type: 'feature' });
    item.reviews = [
      { verdict: 'request-changes', criteria_met: '', summary: '', issues: [], at: '' },
      { verdict: 'request-changes', criteria_met: '', summary: '', issues: [], at: '' },
    ];
    const board: BoardFile = { schema_version: 2, items: [item] };
    expect(() =>
      checkTransitionGuards({ item, to: 'building', trigger: 'issues_found', actor: 'pilot', board, config }),
    ).toThrow(MaxReviewRoundsExceededError);
  });

  it('allows issues_found under max review rounds', () => {
    const config = defaultConfig();
    config.review.max_rounds = 3;
    const item = createDefaultItem({ id: 1, state: 'verifying', type: 'feature' });
    item.reviews = [
      { verdict: 'request-changes', criteria_met: '', summary: '', issues: [], at: '' },
    ];
    const board: BoardFile = { schema_version: 2, items: [item] };
    expect(() =>
      checkTransitionGuards({ item, to: 'building', trigger: 'issues_found', actor: 'pilot', board, config }),
    ).not.toThrow();
  });
});
