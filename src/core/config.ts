import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

import type { Scale, WorkType } from './types.js';

// --- Config interfaces ---

export interface WipConfig {
  building: number;
  pr_ready: number;
}

export interface ReviewConfig {
  max_rounds: number;
}

export interface QualityConfig {
  security_gate: string;
  accessibility_gate: string;
  min_coverage: number;
  require_tests: boolean;
  workflow_mode: string;
}

export interface BuildConfig {
  max_retries: number;
}

export interface BoardConfig {
  provider: string;
}

export interface CiConfig {
  required_checks: string[];
  block_transition: boolean;
}

export interface DebtConfig {
  target_ratio: number;
  audit_trigger: string;
}

export interface DependenciesConfig {
  auto_capture: boolean;
  default_type: WorkType;
  default_autonomy: number;
  security_patches: WorkType;
}

export interface SeverityConfig {
  autonomy: number;
  wip_override: boolean;
}

export interface IncidentsConfig {
  severity_override: boolean;
  critical: SeverityConfig;
  major: SeverityConfig;
}

export interface TokenPricing {
  input_per_1m: number;
  output_per_1m: number;
}

export interface TraditionalEstimates {
  simple_item_hours: number;
  medium_item_hours: number;
  complex_item_hours: number;
}

export interface CostsConfig {
  enabled: boolean;
  token_pricing: TokenPricing;
  dev_hourly_rate: number;
  traditional_estimates: TraditionalEstimates;
}

export interface PluginsConfig {
  board?: string;
  review?: string;
  ci?: string;
  deploy?: string;
  monitor?: string;
  notify?: string;
}

export interface VersoConfig {
  schema_version: number;
  scale: Scale;
  autonomy: Record<WorkType, number>;
  wip: WipConfig;
  review: ReviewConfig;
  quality: QualityConfig;
  build: BuildConfig;
  board: BoardConfig;
  ci: CiConfig;
  delegation: string;
  debt: DebtConfig;
  dependencies: DependenciesConfig;
  incidents: IncidentsConfig;
  costs: CostsConfig;
  plugins?: PluginsConfig;
}

// --- Default factory ---

export function defaultConfig(): VersoConfig {
  return {
    schema_version: 2,
    scale: 'solo' as Scale,
    autonomy: {
      feature: 2,
      bug: 3,
      hotfix: 3,
      refactor: 2,
      chore: 4,
    } as Record<WorkType, number>,
    wip: { building: 2, pr_ready: 5 },
    review: { max_rounds: 3 },
    quality: {
      security_gate: 'warn',
      accessibility_gate: 'warn',
      min_coverage: 80,
      require_tests: true,
      workflow_mode: 'default',
    },
    build: { max_retries: 3 },
    board: { provider: 'local' },
    ci: {
      required_checks: ['typecheck', 'tests', 'lint'],
      block_transition: true,
    },
    delegation: 'subagents',
    debt: { target_ratio: 0.2, audit_trigger: 'milestone' },
    dependencies: {
      auto_capture: true,
      default_type: 'chore' as WorkType,
      default_autonomy: 4,
      security_patches: 'hotfix' as WorkType,
    },
    incidents: {
      severity_override: true,
      critical: { autonomy: 3, wip_override: true },
      major: { autonomy: 3, wip_override: false },
    },
    costs: {
      enabled: true,
      token_pricing: { input_per_1m: 15.0, output_per_1m: 75.0 },
      dev_hourly_rate: 75.0,
      traditional_estimates: {
        simple_item_hours: 4.0,
        medium_item_hours: 12.0,
        complex_item_hours: 32.0,
      },
    },
    plugins: {},
  };
}

export function configForScale(scale: Scale): VersoConfig {
  const config = defaultConfig();
  config.scale = scale;
  switch (scale) {
    case 'solo':
      break;
    case 'small-team':
      config.wip = { building: 3, pr_ready: 8 };
      break;
    case 'startup':
      config.wip = { building: 4, pr_ready: 10 };
      break;
    case 'enterprise':
      config.wip = { building: 5, pr_ready: 15 };
      break;
  }
  return config;
}

export function loadConfig(versoDir: string): VersoConfig {
  const configPath = path.join(versoDir, 'config.yaml');
  if (!fs.existsSync(configPath)) {
    return defaultConfig();
  }
  const contents = fs.readFileSync(configPath, 'utf-8');
  const loaded = yaml.load(contents) as Partial<VersoConfig>;
  const defaults = defaultConfig();
  return { ...defaults, ...loaded } as VersoConfig;
}

export function saveConfig(versoDir: string, config: VersoConfig): void {
  const configPath = path.join(versoDir, 'config.yaml');
  const content = yaml.dump(config, { lineWidth: -1, noRefs: true });
  fs.writeFileSync(configPath, content, 'utf-8');
}
