// Team scale
export type Scale = 'solo' | 'small-team' | 'startup' | 'enterprise';

// Per-user role (determines which pilot variant to use)
// Matches .verso.yaml `role` field
export type Role = 'solo-dev' | 'team-dev' | 'tech-lead' | 'pm';

// Supported AI coding tools
export type AiTool = 'claude' | 'gemini' | 'codex' | 'cursor' | 'windsurf' | 'cline' | 'other';

// Board/project management provider
export type BoardProvider = 'github' | 'linear' | 'local';

// Work types recognized by the state machine
export type WorkType = 'feature' | 'enhancement' | 'bug' | 'hotfix' | 'refactor' | 'chore';

// Wizard answers collected during `verso init`
export interface WizardAnswers {
  projectName: string;
  scale: Scale;
  board: BoardProvider;
  aiTool: AiTool;
  autonomy: number; // 1-4
  role: Role; // defaults to 'solo-dev' for solo
  setupGitHub: boolean;
}

// Represents the parsed .verso/config.yaml structure
export interface VersoConfig {
  scale: Scale;
  autonomy: Record<WorkType, number>; // per work-type autonomy level (1-4)
  wip: {
    building: number;
    pr_ready: number;
  };
  board: {
    provider: BoardProvider;
    project?: string;
  };
  debt: {
    target_ratio: number;
    audit_trigger: string;
  };
  costs: {
    enabled: boolean;
    token_pricing: {
      input_per_1m: number;
      output_per_1m: number;
    };
    dev_hourly_rate: number;
    traditional_estimates: {
      simple_item_hours: number;
      medium_item_hours: number;
      complex_item_hours: number;
    };
  };
  [key: string]: unknown;
}

// Represents the parsed .verso.yaml per-user config
export interface VersoUserConfig {
  role: Role;
  name: string;
  github: string;
  slack?: string;
  email?: string;
  preferred_autonomy_override?: number;
  notifications?: string;
}

// Checksum manifest for tracking template file modifications
export interface ChecksumManifest {
  version: string;
  files: Record<string, string>; // relative path -> SHA-256 hash
}

// Doctor check result
export type CheckSeverity = 'pass' | 'warn' | 'fail';

export interface DoctorCheck {
  name: string;
  severity: CheckSeverity;
  message: string;
}

// Bridge file generator info
export interface BridgeInfo {
  label: string;
  files: string[]; // relative paths of files this bridge generates
  generator: (projectRoot: string, role: Role) => Promise<void>;
}
