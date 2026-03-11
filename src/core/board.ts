import fs from 'node:fs';
import path from 'node:path';

import { ItemNotFoundError } from './error.js';
import type { VersoConfig } from './config.js';
import * as stateMachine from './state-machine.js';
import type { BoardFile, BoardItem, Complexity, State, WorkType } from './types.js';
import { boardFileFromYaml, boardFileToYaml } from './types.js';

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function nextId(board: BoardFile): number {
  if (board.items.length === 0) return 1;
  return Math.max(...board.items.map((item) => item.id)) + 1;
}

export function loadBoard(versoDir: string): BoardFile {
  const boardPath = path.join(versoDir, 'board.yaml');
  if (!fs.existsSync(boardPath)) {
    return { schema_version: 2, items: [] };
  }
  const content = fs.readFileSync(boardPath, 'utf-8');
  return boardFileFromYaml(content);
}

export function saveBoard(versoDir: string, board: BoardFile): void {
  const boardPath = path.join(versoDir, 'board.yaml');
  const content = boardFileToYaml(board);
  const dir = path.dirname(boardPath);
  const tmpPath = path.join(dir, `.board.yaml.tmp.${process.pid}`);
  fs.writeFileSync(tmpPath, content, 'utf-8');
  fs.renameSync(tmpPath, boardPath);
}

export interface AddItemOpts {
  description?: string;
  milestone?: string;
  labels?: string[];
  complexity?: Complexity;
  spec_path?: string;
}

export function addItem(
  board: BoardFile,
  workType: WorkType,
  title: string,
  autonomy: number,
  opts?: AddItemOpts,
): number {
  const id = nextId(board);
  const now = nowIso();
  const item: BoardItem = {
    id,
    title,
    type: workType,
    state: 'captured',
    assignee: '',
    autonomy,
    branch: '',
    pr: '',
    retries: 0,
    complexity: opts?.complexity ?? '',
    agent_sessions: 0,
    created_at: now,
    updated_at: now,
    labels: opts?.labels ?? [],
    transitions: [],
    reviews: [],
    external: {},
    description: opts?.description ?? '',
    spec_path: opts?.spec_path ?? '',
    blocked_by: [],
    blocked_reason: '',
    milestone: opts?.milestone ?? '',
    costs: {
      tokens_in: 0,
      tokens_out: 0,
      api_cost: 0,
      agent_wall_time: 0,
      dev_gate_time: 0,
      dev_review_time: 0,
    },
  };
  board.items.push(item);
  return id;
}

export function getItem(board: BoardFile, id: number): BoardItem | undefined {
  return board.items.find((item) => item.id === id);
}

export function listItems(
  board: BoardFile,
  state?: State,
  workType?: WorkType,
): BoardItem[] {
  return board.items
    .filter((item) => state === undefined || item.state === state)
    .filter((item) => workType === undefined || item.type === workType);
}

export interface MoveOpts {
  blocked_reason?: string;
}

export function moveItem(
  board: BoardFile,
  id: number,
  to: State,
  trigger: string,
  actor: string,
  opts?: MoveOpts,
): void {
  const item = getItem(board, id);
  if (!item) throw new ItemNotFoundError(id);
  stateMachine.validateTransition(item.state, to);

  if (to === 'blocked' && !opts?.blocked_reason) {
    throw new Error('blocked_reason is required when moving to blocked state');
  }

  const from = item.state;
  item.state = to;
  item.updated_at = nowIso();

  if (to === 'blocked') {
    item.blocked_reason = opts!.blocked_reason!;
  } else if (from === 'blocked') {
    item.blocked_reason = '';
  }

  item.transitions.push({
    from,
    to,
    trigger,
    actor,
    at: item.updated_at,
  });
}

export interface UpdateFields {
  title?: string;
  assignee?: string;
  description?: string;
  complexity?: Complexity;
  autonomy?: number;
  branch?: string;
  pr?: string;
  labels?: string[];
  milestone?: string;
  blocked_reason?: string;
  spec_path?: string;
}

export function updateItem(
  board: BoardFile,
  id: number,
  updates: UpdateFields,
): void {
  const item = getItem(board, id);
  if (!item) throw new ItemNotFoundError(id);
  if (updates.title !== undefined) item.title = updates.title;
  if (updates.assignee !== undefined) item.assignee = updates.assignee;
  if (updates.description !== undefined) item.description = updates.description;
  if (updates.complexity !== undefined) item.complexity = updates.complexity;
  if (updates.autonomy !== undefined) item.autonomy = updates.autonomy;
  if (updates.branch !== undefined) item.branch = updates.branch;
  if (updates.pr !== undefined) item.pr = updates.pr;
  if (updates.labels !== undefined) item.labels = updates.labels;
  if (updates.milestone !== undefined) item.milestone = updates.milestone;
  if (updates.blocked_reason !== undefined) item.blocked_reason = updates.blocked_reason;
  if (updates.spec_path !== undefined) item.spec_path = updates.spec_path;
  item.updated_at = nowIso();
}

export function cancelItem(board: BoardFile, id: number, reason: string): void {
  moveItem(board, id, 'cancelled', reason, 'captain');
}

export function countInState(board: BoardFile, state: State): number {
  return board.items.filter((item) => item.state === state).length;
}

export function transitionItem(
  board: BoardFile,
  id: number,
  to: State,
  trigger: string,
  actor: string,
  config: VersoConfig,
  opts?: MoveOpts,
): void {
  const item = getItem(board, id);
  if (!item) throw new ItemNotFoundError(id);
  stateMachine.checkTransitionGuards({ item, to, trigger, actor, board, config });
  moveItem(board, id, to, trigger, actor, opts);
}
