import type { State } from './types.js';

export class VersoError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'VersoError';
    this.code = code;
  }
}

export class InvalidTransitionError extends VersoError {
  from: State;
  to: State;
  validTargets: string[];

  constructor(from: State, to: State, validTargets: string[]) {
    const suffix = validTargets.length === 0
      ? `'${from}' is a terminal state — no transitions allowed`
      : `Valid targets: ${validTargets.join(', ')}`;
    super(
      `Invalid transition from '${from}' to '${to}'. ${suffix}`,
      'INVALID_TRANSITION',
    );
    this.name = 'InvalidTransitionError';
    this.from = from;
    this.to = to;
    this.validTargets = validTargets;
  }
}

export class WipLimitReachedError extends VersoError {
  state: string;
  current: number;
  limit: number;

  constructor(state: string, current: number, limit: number) {
    super(`WIP limit reached for state '${state}': ${current}/${limit}`, 'WIP_LIMIT_REACHED');
    this.name = 'WipLimitReachedError';
    this.state = state;
    this.current = current;
    this.limit = limit;
  }
}

export class MaxRetriesExceededError extends VersoError {
  itemId: number;
  retries: number;

  constructor(itemId: number, retries: number) {
    super(`item #${itemId} exceeded max retries (${retries})`, 'MAX_RETRIES_EXCEEDED');
    this.name = 'MaxRetriesExceededError';
    this.itemId = itemId;
    this.retries = retries;
  }
}

export class MaxReviewRoundsExceededError extends VersoError {
  itemId: number;
  rounds: number;

  constructor(itemId: number, rounds: number) {
    super(`item #${itemId} exceeded max review rounds (${rounds}) — escalate required`, 'MAX_REVIEW_ROUNDS_EXCEEDED');
    this.name = 'MaxReviewRoundsExceededError';
    this.itemId = itemId;
    this.rounds = rounds;
  }
}

export class ItemNotFoundError extends VersoError {
  id: number;

  constructor(id: number) {
    super(`item #${id} not found`, 'ITEM_NOT_FOUND');
    this.name = 'ItemNotFoundError';
    this.id = id;
  }
}

export class InvalidStateError extends VersoError {
  state: string;

  constructor(state: string) {
    super(`invalid state: '${state}'`, 'INVALID_STATE');
    this.name = 'InvalidStateError';
    this.state = state;
  }
}

export class InvalidWorkTypeError extends VersoError {
  workType: string;

  constructor(workType: string) {
    super(`invalid work type: '${workType}'`, 'INVALID_WORK_TYPE');
    this.name = 'InvalidWorkTypeError';
    this.workType = workType;
  }
}

export class ConfigError extends VersoError {
  constructor(message: string) {
    super(`config error: ${message}`, 'CONFIG_ERROR');
    this.name = 'ConfigError';
  }
}

export class SchemaError extends VersoError {
  constructor(message: string) {
    super(`schema error: ${message}`, 'SCHEMA_ERROR');
    this.name = 'SchemaError';
  }
}

export class PluginError extends VersoError {
  constructor(message: string) {
    super(message, 'PLUGIN_ERROR');
  }
}

export class PluginLoadError extends VersoError {
  pluginName: string;

  constructor(pluginName: string, reason: string) {
    super(`Failed to load plugin "${pluginName}": ${reason}`, 'PLUGIN_LOAD_ERROR');
    this.name = 'PluginLoadError';
    this.pluginName = pluginName;
  }
}

export class SyncError extends VersoError {
  constructor(message: string) {
    super(message, 'SYNC_ERROR');
    this.name = 'SyncError';
  }
}

export class WorkTypeRestrictionError extends VersoError {
  itemId: number;
  workType: string;
  transition: string;

  constructor(itemId: number, workType: string, transition: string) {
    super(
      `item #${itemId} (type '${workType}') is not allowed for transition '${transition}'`,
      'WORK_TYPE_RESTRICTION',
    );
    this.name = 'WorkTypeRestrictionError';
    this.itemId = itemId;
    this.workType = workType;
    this.transition = transition;
  }
}

export class AutonomyApprovalRequiredError extends VersoError {
  itemId: number;
  transition: string;
  autonomyLevel: number;

  constructor(itemId: number, transition: string, autonomyLevel: number) {
    super(
      `item #${itemId} requires captain approval for '${transition}' at autonomy level ${autonomyLevel}`,
      'AUTONOMY_APPROVAL_REQUIRED',
    );
    this.name = 'AutonomyApprovalRequiredError';
    this.itemId = itemId;
    this.transition = transition;
    this.autonomyLevel = autonomyLevel;
  }
}

export class CiCheckFailedError extends VersoError {
  failedChecks: string[];

  constructor(failedChecks: string[]) {
    super(
      `CI checks failed: ${failedChecks.join(', ')}`,
      'CI_CHECK_FAILED',
    );
    this.name = 'CiCheckFailedError';
    this.failedChecks = failedChecks;
  }
}
