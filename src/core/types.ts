import yaml from 'js-yaml';

// --- String literal union types ---

export type State =
  | 'captured'
  | 'refined'
  | 'queued'
  | 'blocked'
  | 'building'
  | 'verifying'
  | 'pr_ready'
  | 'done'
  | 'cancelled';

export type WorkType = 'feature' | 'bug' | 'hotfix' | 'refactor' | 'chore';

export type Complexity = 'simple' | 'medium' | 'complex' | '';

export type Scale = 'solo' | 'small-team' | 'startup' | 'enterprise';

export type CheckSeverity = 'pass' | 'warn' | 'fail';

export const ALL_STATES: State[] = [
  'captured',
  'refined',
  'queued',
  'blocked',
  'building',
  'verifying',
  'pr_ready',
  'done',
  'cancelled',
];

export const ALL_WORK_TYPES: WorkType[] = ['feature', 'bug', 'hotfix', 'refactor', 'chore'];

export const TERMINAL_STATES: State[] = ['done', 'cancelled'];

// --- Interfaces ---

export interface Transition {
  from: State;
  to: State;
  trigger: string;
  actor: string;
  at: string;
}

export interface Review {
  verdict: string;
  criteria_met: string;
  summary: string;
  issues: string[];
  at: string;
}

export interface ItemCosts {
  tokens_in: number;
  tokens_out: number;
  api_cost: number;
  agent_wall_time: number;
  dev_gate_time: number;
  dev_review_time: number;
}

export interface BoardItem {
  id: number;
  title: string;
  type: WorkType;
  state: State;
  assignee: string;
  autonomy: number;
  branch: string;
  pr: string;
  retries: number;
  complexity: Complexity;
  agent_sessions: number;
  created_at: string;
  updated_at: string;
  labels: string[];
  transitions: Transition[];
  reviews: Review[];
  external: Record<string, unknown>;
  description: string;
  spec_path: string;
  blocked_by: number[];
  blocked_reason: string;
  milestone: string;
  costs: ItemCosts;
}

export interface BoardFile {
  schema_version: number;
  items: BoardItem[];
}

export interface DoctorCheck {
  name: string;
  severity: CheckSeverity;
  message: string;
}

// --- User config (.verso.yaml) ---

export type UserRole = 'captain' | 'pilot' | 'reviewer';

export type OutputFormatPreference = 'human' | 'plain' | 'json';

export interface UserPreferences {
  format?: OutputFormatPreference;
  autonomy_override?: number | null;
}

export interface UserIdentity {
  name: string;
  github?: string;
  role: string;
}

export interface UserConfig {
  user: UserIdentity;
  preferences?: UserPreferences;
}

// --- Defaults ---

export function createDefaultItem(overrides: Partial<BoardItem> = {}): BoardItem {
  const defaults: BoardItem = {
    id: 0,
    title: '',
    type: 'feature',
    state: 'captured',
    assignee: '',
    autonomy: 0,
    branch: '',
    pr: '',
    retries: 0,
    complexity: '',
    agent_sessions: 0,
    created_at: '',
    updated_at: '',
    labels: [],
    transitions: [],
    reviews: [],
    external: {},
    description: '',
    spec_path: '',
    blocked_by: [],
    blocked_reason: '',
    milestone: '',
    costs: {
      tokens_in: 0,
      tokens_out: 0,
      api_cost: 0,
      agent_wall_time: 0,
      dev_gate_time: 0,
      dev_review_time: 0,
    },
  };
  return {
    ...defaults,
    ...overrides,
    costs: { ...defaults.costs, ...(overrides.costs ?? {}) },
  };
}

// --- YAML serialization helpers ---

export function boardFileToYaml(board: BoardFile): string {
  return yaml.dump(board, { lineWidth: -1, noRefs: true });
}

export function boardFileFromYaml(content: string): BoardFile {
  const raw = yaml.load(content) as Record<string, unknown>;
  const rawItems = (raw.items as Record<string, unknown>[]) || [];
  const items: BoardItem[] = rawItems.map((r) =>
    createDefaultItem(r as Partial<BoardItem>),
  );
  return {
    schema_version: (raw.schema_version as number) ?? 1,
    items,
  };
}
