import { type Scale, type Role, type AiTool, type WorkType } from './types/index.js';

// Framework directory name
export const VERSO_DIR = '.verso';

// Personal config file (gitignored)
export const VERSO_YAML = '.verso.yaml';

// Example config for team onboarding
export const VERSO_YAML_EXAMPLE = '.verso.yaml.example';

// Checksums manifest file
export const CHECKSUMS_FILE = '.verso/.checksums.json';

// Map roles to their pilot module file
export const PILOT_MODULE_FOR_ROLE: Record<Role, string> = {
  'solo-dev': 'solo-dev.md',
  'team-dev': 'team-dev.md',
  'tech-lead': 'tech-lead.md',
  'pm': 'pm.md',
};

// Default WIP limits per scale
export const SCALE_WIP_DEFAULTS: Record<Scale, { building: number; pr_ready: number }> = {
  'solo': { building: 2, pr_ready: 5 },
  'small-team': { building: 3, pr_ready: 8 },
  'startup': { building: 5, pr_ready: 12 },
  'enterprise': { building: 8, pr_ready: 20 },
};

// Scale display labels
export const SCALE_LABELS: Record<Scale, string> = {
  'solo': 'Solo developer',
  'small-team': 'Small team (2-5 devs)',
  'startup': 'Startup (5-15 devs)',
  'enterprise': 'Enterprise (15+ devs)',
};

// Autonomy level display labels
export const AUTONOMY_LABELS: Record<number, string> = {
  1: '1 - Full control (approve spec, plan, every commit, and PR)',
  2: '2 - Standard (approve spec and PR)',
  3: '3 - Light touch (approve only PR)',
  4: '4 - Full auto (agent handles everything, you just merge)',
};

// Default autonomy levels per work type
// These are the defaults written to config.yaml during init
export const DEFAULT_AUTONOMY_PER_WORK_TYPE: Record<WorkType, number> = {
  feature: 2,
  bug: 3,
  hotfix: 3,
  refactor: 2,
  chore: 4,
};

// AI tool display labels and identifiers
export const AI_TOOL_LABELS: Record<AiTool, string> = {
  claude: 'Claude Code',
  gemini: 'Gemini CLI',
  codex: 'Codex CLI',
  cursor: 'Cursor',
  windsurf: 'Windsurf',
  cline: 'Cline',
  other: 'Other',
};

// Required files that must exist in .verso/
export const REQUIRED_FILES = [
  '.verso/config.yaml',
  '.verso/roadmap.yaml',
  '.verso/state-machine.yaml',
  '.verso/releases.yaml',
  '.verso/board.yaml',
  '.verso/agents/pilot.md',
  '.verso/agents/builder.md',
  '.verso/agents/reviewer.md',
];

// All template files (for checksums tracking)
// Note: pilot.md is a composed file (core + role module), not copied directly from templates
export const TEMPLATE_FILES = [
  '.verso/config.yaml',
  '.verso/roadmap.yaml',
  '.verso/state-machine.yaml',
  '.verso/releases.yaml',
  '.verso/board.yaml',
  '.verso/agents/pilot.md',
  '.verso/agents/builder.md',
  '.verso/agents/reviewer.md',
];

// Role display labels
export const ROLE_LABELS: Record<Role, string> = {
  'solo-dev': 'Solo Developer',
  'team-dev': 'Team Developer',
  'tech-lead': 'Tech Lead',
  'pm': 'PM / Product Owner',
};
