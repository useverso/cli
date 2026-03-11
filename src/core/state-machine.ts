import {
  AutonomyApprovalRequiredError,
  CiCheckFailedError,
  InvalidTransitionError,
  MaxRetriesExceededError,
  MaxReviewRoundsExceededError,
  WipLimitReachedError,
  WorkTypeRestrictionError,
} from './error.js';
import type { BoardFile, BoardItem, State } from './types.js';
import { TERMINAL_STATES } from './types.js';
import type { VersoConfig } from './config.js';
import type { CiPlugin, PluginContext } from './plugin.js';

interface TransitionEntry {
  from: State;
  to: State;
  trigger: string;
}

const TRANSITIONS: TransitionEntry[] = [
  { from: 'captured', to: 'refined', trigger: 'spec_written' },
  { from: 'captured', to: 'queued', trigger: 'simple_work' },
  { from: 'captured', to: 'cancelled', trigger: 'rejected_or_duplicate' },
  { from: 'refined', to: 'queued', trigger: 'breakdown_complete' },
  { from: 'queued', to: 'building', trigger: 'builder_spawned' },
  { from: 'queued', to: 'blocked', trigger: 'blocked_by_external' },
  { from: 'building', to: 'verifying', trigger: 'pr_created' },
  { from: 'building', to: 'queued', trigger: 'build_failed' },
  { from: 'building', to: 'blocked', trigger: 'blocked_by_external' },
  { from: 'building', to: 'blocked', trigger: 'max_retries_exceeded' },
  { from: 'building', to: 'pr_ready', trigger: 'review_skipped' },
  { from: 'verifying', to: 'pr_ready', trigger: 'reviewer_commented' },
  { from: 'verifying', to: 'building', trigger: 'issues_found' },
  { from: 'verifying', to: 'blocked', trigger: 'blocked_by_external' },
  { from: 'blocked', to: 'queued', trigger: 'blocker_resolved' },
  { from: 'pr_ready', to: 'done', trigger: 'pr_merged' },
  { from: 'pr_ready', to: 'building', trigger: 'dev_requested_changes' },
];

export function validTransitions(state: State): Array<{ to: State; trigger: string }> {
  return TRANSITIONS.filter((t) => t.from === state).map((t) => ({ to: t.to, trigger: t.trigger }));
}

export function validateTransition(from: State, to: State): string {
  if (isTerminal(from)) {
    throw new InvalidTransitionError(from, to, []);
  }
  const entry = TRANSITIONS.find((t) => t.from === from && t.to === to);
  if (!entry) {
    const targets = validTransitions(from).map((t) => t.to);
    throw new InvalidTransitionError(from, to, targets);
  }
  return entry.trigger;
}

export function canTransition(from: State, to: State): boolean {
  return TRANSITIONS.some((t) => t.from === from && t.to === to);
}

export function isTerminal(state: State): boolean {
  return TERMINAL_STATES.includes(state);
}

export function checkWipGuard(count: number, wipLimit: number, state: State = 'building'): void {
  if (count >= wipLimit) {
    throw new WipLimitReachedError(state, count, wipLimit);
  }
}

export function checkRetryGuard(itemId: number, retries: number, maxRetries: number): void {
  if (retries >= maxRetries) {
    throw new MaxRetriesExceededError(itemId, retries);
  }
}

export function checkReviewRoundsGuard(itemId: number, rounds: number, maxRounds: number): void {
  if (rounds >= maxRounds) {
    throw new MaxReviewRoundsExceededError(itemId, rounds);
  }
}

// --- Unified guard system ---

export interface GuardContext {
  item: BoardItem;
  to: State;
  trigger: string;
  actor: string;
  board: BoardFile;
  config: VersoConfig;
}

export function checkTransitionGuards(ctx: GuardContext): void {
  const { item, to, trigger, actor, board, config } = ctx;
  const from = item.state;

  // 1. WIP check (for transitions TO building or pr_ready)
  if (to === 'building') {
    const count = board.items.filter((i) => i.state === 'building').length;
    checkWipGuard(count, config.wip.building, 'building');
  }
  if (to === 'pr_ready') {
    const count = board.items.filter((i) => i.state === 'pr_ready').length;
    checkWipGuard(count, config.wip.pr_ready, 'pr_ready');
  }

  // 2. Work type restrictions
  if (from === 'captured' && to === 'queued' && trigger === 'simple_work') {
    if (item.type !== 'hotfix' && item.type !== 'chore') {
      throw new WorkTypeRestrictionError(item.id, item.type, `${from}->${to} (${trigger})`);
    }
  }
  if (from === 'building' && to === 'pr_ready' && trigger === 'review_skipped') {
    if (item.type !== 'chore') {
      throw new WorkTypeRestrictionError(item.id, item.type, `${from}->${to} (${trigger})`);
    }
  }

  // 3. Autonomy approval check
  const autonomyLevel = config.autonomy?.[item.type] ?? 2;
  if (actor !== 'captain') {
    // At autonomy <= 2, block spec/plan approval (captured->refined, refined->queued)
    if (autonomyLevel <= 2) {
      if (
        (from === 'captured' && to === 'refined') ||
        (from === 'refined' && to === 'queued')
      ) {
        throw new AutonomyApprovalRequiredError(
          item.id,
          `${from}->${to}`,
          autonomyLevel,
        );
      }
    }
    // At autonomy <= 3, block ship approval (pr_ready->done)
    if (autonomyLevel <= 3) {
      if (from === 'pr_ready' && to === 'done') {
        throw new AutonomyApprovalRequiredError(
          item.id,
          `${from}->${to}`,
          autonomyLevel,
        );
      }
    }
  }

  // 4. Retry limit guard (building->queued via build_failed)
  if (to === 'queued' && trigger === 'build_failed') {
    const maxRetries = config.build?.max_retries ?? 3;
    checkRetryGuard(item.id, item.retries, maxRetries);
  }

  // 5. Review rounds guard (verifying->building via issues_found)
  if (to === 'building' && trigger === 'issues_found') {
    const maxRounds = config.review?.max_rounds ?? 3;
    checkReviewRoundsGuard(item.id, item.reviews.length, maxRounds);
  }
}

export async function checkCiGuard(
  branch: string,
  config: VersoConfig,
  ciPlugin: CiPlugin | null,
  ctx?: { itemId: number },
): Promise<void> {
  if (!ciPlugin) return;
  if (!config.ci?.block_transition) return;

  const pluginCtx: PluginContext = {
    versoDir: '',
    config,
    board: { schema_version: 2, items: [] },
  };

  const checks = await ciPlugin.getCheckStatus(pluginCtx, branch);
  const failed = checks.filter((c) => !c.passed).map((c) => c.name);

  if (failed.length > 0) {
    throw new CiCheckFailedError(failed);
  }
}
