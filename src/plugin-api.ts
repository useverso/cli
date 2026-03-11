// Public API for plugin authors
export type {
  PluginType,
  PluginFactory,
  PluginContext,
  PluginMeta,
  PluginStatusInfo,
  DoctorCheck,
  BasePlugin,
  BoardPlugin,
  ReviewPlugin,
  CiPlugin,
  DeployPlugin,
  MonitorPlugin,
  NotifyPlugin,
  VersoPlugin,
  SyncAction,
  SyncResult,
  PrStatus,
  PrCreateInput,
  PrMergeResult,
} from './core/plugin.js';

export type {
  State,
  WorkType,
  BoardItem,
  BoardFile,
  Complexity,
  Transition,
  Review,
  ItemCosts,
} from './core/types.js';

export type { VersoConfig } from './core/config.js';
