import type { State, WorkType, BoardItem, BoardFile } from './types.js';
import type { VersoConfig } from './config.js';

// --- Plugin type classification ---

export type PluginType = 'board' | 'review' | 'ci' | 'deploy' | 'monitor' | 'notify';

// --- Core plugin types ---

export interface PluginContext {
  versoDir: string;
  config: VersoConfig;
  board: BoardFile;
}

export interface PluginMeta {
  name: string;
  type: PluginType;
  version: string;
}

export interface PluginStatusInfo {
  label: string;
  details: string[];
}

export interface DoctorCheck {
  name: string;
  passed: boolean;
  message: string;
}

export type PluginFactory = (config: Record<string, unknown>) => VersoPlugin;

// --- Sync types ---

export type SyncAction =
  | { type: 'move'; itemId: number; to: State; trigger: string }
  | { type: 'update'; itemId: number; fields: Partial<BoardItem> }
  | { type: 'add'; workType: WorkType; title: string; external?: Record<string, unknown> };

export interface SyncResult {
  pushed: number;
  actions: SyncAction[];
  errors: string[];
}

// --- PR types (for ReviewPlugin) ---

export interface PrStatus {
  id: string;
  url: string;
  state: 'open' | 'merged' | 'closed';
  mergeable: boolean;
  checks: { name: string; passed: boolean }[];
}

export interface PrCreateInput {
  itemId: number;
  title: string;
  branch: string;
  body?: string;
}

export interface PrMergeResult {
  merged: boolean;
  sha?: string;
  error?: string;
}

// --- Base plugin interface ---

export interface BasePlugin {
  meta: PluginMeta;
  setup?(ctx: PluginContext): Promise<void>;
  validate?(ctx: PluginContext): Promise<DoctorCheck[]>;
  statusInfo?(ctx: PluginContext): Promise<PluginStatusInfo>;
}

// --- Typed plugin interfaces ---

export interface BoardPlugin extends BasePlugin {
  push(ctx: PluginContext, items: BoardItem[]): Promise<SyncResult>;
  pull(ctx: PluginContext): Promise<SyncAction[]>;
}

export interface ReviewPlugin extends BasePlugin {
  onPrCreated(ctx: PluginContext, input: PrCreateInput): Promise<PrStatus>;
  getPrStatus(ctx: PluginContext, prId: string): Promise<PrStatus>;
  mergePr(ctx: PluginContext, prId: string): Promise<PrMergeResult>;
}

export interface CiPlugin extends BasePlugin {
  getCheckStatus(ctx: PluginContext, branch: string): Promise<{ name: string; passed: boolean }[]>;
}

export interface DeployPlugin extends BasePlugin {
  deploy(ctx: PluginContext, itemId: number): Promise<{ success: boolean; url?: string; error?: string }>;
}

export interface MonitorPlugin extends BasePlugin {
  getAlerts(ctx: PluginContext): Promise<SyncAction[]>;
}

export interface NotifyPlugin extends BasePlugin {
  send(ctx: PluginContext, message: string, channel?: string): Promise<void>;
}

export type VersoPlugin = BoardPlugin | ReviewPlugin | CiPlugin | DeployPlugin | MonitorPlugin | NotifyPlugin;

// --- Helper functions ---

export function resolvePackageName(shortName: string): string[] {
  return [`@useverso/plugin-${shortName}`, `verso-plugin-${shortName}`];
}

export function createPluginContext(versoDir: string, config: VersoConfig, board: BoardFile): PluginContext {
  return { versoDir, config, board };
}

// --- Plugin shape validation ---

const REQUIRED_METHODS: Record<PluginType, string[]> = {
  board: ['push', 'pull'],
  review: ['onPrCreated', 'getPrStatus', 'mergePr'],
  ci: ['getCheckStatus'],
  deploy: ['deploy'],
  monitor: ['getAlerts'],
  notify: ['send'],
};

export function validatePluginShape(plugin: unknown, expectedType: PluginType): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!plugin || typeof plugin !== 'object') {
    return { valid: false, errors: ['Plugin is not an object'] };
  }

  const p = plugin as Record<string, unknown>;

  // Check meta
  if (!p.meta || typeof p.meta !== 'object') {
    errors.push('Plugin missing meta property');
  } else {
    const meta = p.meta as Record<string, unknown>;
    if (typeof meta.name !== 'string') errors.push('meta.name must be a string');
    if (typeof meta.type !== 'string') errors.push('meta.type must be a string');
    if (typeof meta.version !== 'string') errors.push('meta.version must be a string');
    if (meta.type !== expectedType) errors.push(`Plugin type "${meta.type}" does not match expected "${expectedType}"`);
  }

  // Check required methods
  for (const method of REQUIRED_METHODS[expectedType]) {
    if (typeof p[method] !== 'function') {
      errors.push(`Plugin missing required method: ${method}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
