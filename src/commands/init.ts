import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

import { Command } from 'commander';
import chalk from 'chalk';
import { select, input } from '@inquirer/prompts';
import yaml from 'js-yaml';

import { getTemplate, composePilot } from '../templates.js';
import { generateBridge, type AiTool } from '../bridges.js';
import { computeChecksums, saveChecksums } from './upgrade.js';
import type { OutputFormat } from '../output.js';
import { printError } from '../output.js';
import type { PluginsConfig } from '../core/config.js';
import { saveUserConfig, createDefaultUserConfig } from '../core/user.js';
import type { UserConfig } from '../core/types.js';

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize a .verso directory in the current project')
    .option('--defaults', 'Use default settings (solo, local, no bridge)')
    .action(async (opts) => {
      const format = (program.opts().format || 'human') as OutputFormat;
      try {
        if (opts.defaults) {
          runInitDefaults(process.cwd(), format);
        } else {
          await runInitInteractive(process.cwd(), format);
        }
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err), format);
        process.exitCode = 1;
      }
    });
}

function runInitDefaults(cwd: string, format: OutputFormat): void {
  const versoDir = join(cwd, '.verso');

  if (existsSync(versoDir)) {
    throw new Error('.verso directory already exists. Use `verso upgrade` to update.');
  }

  scaffoldVerso(versoDir, 'solo');
  updateGitignore(cwd);

  // Create .verso.yaml with defaults from git config
  const userConfig = createDefaultUserConfig();
  saveUserConfig(cwd, userConfig);

  // Generate AGENTS.md as a baseline
  const agentsMdPath = join(cwd, 'AGENTS.md');
  if (!existsSync(agentsMdPath)) {
    const content = [
      '# AGENTS.md',
      '',
      'This project uses the VERSO development framework.',
      '',
      'Your active pilot is `.verso/agents/pilot.md` -- read it and follow its instructions for all development tasks.',
      '',
      'Use `verso` CLI commands to manage board state -- never edit YAML files directly.',
      '',
    ].join('\n');
    writeFileSync(agentsMdPath, content, 'utf-8');
  }

  console.log('Initialized .verso/ with default settings (solo, no AI bridge)');
  console.log('');
  console.log('Next steps:');
  console.log('  verso status    - check project status');
  console.log('  verso doctor    - validate configuration');
  console.log('  verso board add - add your first work item');
}

async function runInitInteractive(cwd: string, format: OutputFormat): Promise<void> {
  const versoDir = join(cwd, '.verso');

  if (existsSync(versoDir)) {
    throw new Error('.verso directory already exists. Use `verso upgrade` to update.');
  }

  // Select scale
  const scale = await select({
    message: 'Select your team scale',
    choices: [
      { value: 'solo', name: 'Solo developer (minimal ceremony)' },
      { value: 'small-team', name: 'Small team (2-5 devs, lightweight coordination)' },
      { value: 'startup', name: 'Startup (5-15 devs, structured but lean)' },
      { value: 'enterprise', name: 'Enterprise (15+ devs, full governance)' },
    ],
    default: 'solo',
  });

  // Select AI tool
  const aiTool = await select<AiTool>({
    message: 'Select your AI coding tool',
    choices: [
      { value: 'claude-code', name: 'Claude Code' },
      { value: 'cursor', name: 'Cursor' },
      { value: 'windsurf', name: 'Windsurf' },
      { value: 'none', name: 'None (manual setup)' },
    ],
    default: 'claude-code',
  });

  // Select board integration
  const boardIntegration = await select({
    message: 'Board integration:',
    choices: [
      { value: 'local', name: 'Local only (board.yaml)' },
      { value: 'github', name: 'GitHub Issues + Projects' },
      { value: 'linear', name: 'Linear' },
    ],
    default: 'local',
  });

  // Select review system
  const reviewSystem = await select({
    message: 'Review system:',
    choices: [
      { value: 'none', name: 'None (manual review)' },
      { value: 'gitveto', name: 'GitVeto' },
      { value: 'github', name: 'GitHub PR Reviews' },
    ],
    default: 'none',
  });

  // Select CI integration
  const ciSystem = await select({
    message: 'CI integration:',
    choices: [
      { value: 'none', name: 'None' },
      { value: 'github', name: 'GitHub Actions' },
    ],
    default: boardIntegration === 'github' ? 'github' : 'none',
  });

  // Select deploy integration
  const deploySystem = await select({
    message: 'Deploy integration:',
    choices: [
      { value: 'none', name: 'None' },
      { value: 'github', name: 'GitHub Deployments' },
    ],
    default: 'none',
  });

  // Build plugins config
  const plugins: PluginsConfig = {};
  if (boardIntegration !== 'local') plugins.board = boardIntegration;
  if (reviewSystem !== 'none') plugins.review = reviewSystem;
  if (ciSystem !== 'none') plugins.ci = ciSystem;
  if (deploySystem !== 'none') plugins.deploy = deploySystem;

  // Deduplicate package names before installing
  const packageNames = new Set<string>();
  for (const name of Object.values(plugins)) {
    if (name) packageNames.add(name);
  }
  for (const name of packageNames) {
    try {
      console.log(`Installing @useverso/plugin-${name}...`);
      execSync(`npm install @useverso/plugin-${name}`, { cwd, stdio: 'pipe' });
    } catch {
      console.log(chalk.yellow(`Warning: Could not install @useverso/plugin-${name}. Install it manually.`));
    }
  }

  scaffoldVerso(versoDir, scale, Object.keys(plugins).length > 0 ? plugins : undefined);
  updateGitignore(cwd);

  // Ask for user identity
  const defaultUserConfig = createDefaultUserConfig();

  const userName = await input({
    message: 'Your name:',
    default: defaultUserConfig.user.name,
  });

  const userGithub = await input({
    message: 'GitHub handle (optional):',
    default: defaultUserConfig.user.github || '',
  });

  const userConfig: UserConfig = {
    user: {
      name: userName,
      role: 'captain',
    },
    preferences: {
      format: 'human',
      autonomy_override: null,
    },
  };
  if (userGithub) {
    userConfig.user.github = userGithub;
  }
  saveUserConfig(cwd, userConfig);

  // Generate bridge files
  const bridgeFiles = generateBridge(cwd, aiTool);

  console.log('');
  console.log(`Initialized .verso/ for ${scale} scale`);
  if (bridgeFiles.length > 0) {
    const toolName =
      aiTool === 'claude-code' ? 'Claude Code' : aiTool === 'cursor' ? 'Cursor' : 'Windsurf';
    console.log(`Generated ${toolName} bridge:`);
    for (const f of bridgeFiles) {
      console.log(`  ${f}`);
    }
  }
  console.log('');
  console.log('Next steps:');
  console.log('  verso status    - check project status');
  console.log('  verso doctor    - validate configuration');
  console.log('  verso board add - add your first work item');
}

/** Update .gitignore to include VERSO-specific entries. Preserves existing content. */
export function updateGitignore(cwd: string): void {
  const gitignorePath = join(cwd, '.gitignore');
  const entries = ['.verso.yaml', '.worktrees/', '.verso/.checksums.json'];
  let content = '';

  if (existsSync(gitignorePath)) {
    content = readFileSync(gitignorePath, 'utf-8');
  }

  const lines = content.split('\n');
  const missing = entries.filter((entry) => !lines.some((line) => line.trim() === entry));

  if (missing.length === 0) return;

  const additions = missing.join('\n');
  const separator = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
  const header = content.length > 0 ? '\n# VERSO\n' : '# VERSO\n';
  writeFileSync(gitignorePath, content + separator + header + additions + '\n', 'utf-8');
}

/** Scaffold the .verso/ directory with all templates. */
export function scaffoldVerso(versoDir: string, scale: string, plugins?: PluginsConfig): void {
  const agentsDir = join(versoDir, 'agents');
  const templatesDir = join(versoDir, 'templates');
  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(templatesDir, { recursive: true });

  // Write YAML files
  const yamlFiles = ['config.yaml', 'board.yaml', 'roadmap.yaml', 'state-machine.yaml', 'releases.yaml'];

  for (const name of yamlFiles) {
    let content = getTemplate(`yaml/${name}`);
    if (!content) {
      throw new Error(`Missing template: yaml/${name}`);
    }

    // For config.yaml, replace the scale value and add plugins
    if (name === 'config.yaml') {
      content = content.replace('scale: solo', `scale: ${scale}`);
      if (plugins && Object.keys(plugins).length > 0) {
        const pluginsYaml = yaml.dump({ plugins }, { lineWidth: -1, noRefs: true });
        content = content + '\n# ---------------------------------------------------------------------------\n# Plugins\n# ---------------------------------------------------------------------------\n' + pluginsYaml;

        // Add GitHub plugin configuration hint (commented out — auto-detected from git remote)
        const hasGithub = Object.values(plugins).some((v) => v === 'github');
        if (hasGithub) {
          content += '\n# GitHub plugin configuration (optional — auto-detected from git remote)\n# github:\n#   owner: your-org\n#   repo: your-repo\n#   token_env: GITHUB_TOKEN\n';
        }
      }
    }

    writeFileSync(join(versoDir, name), content, 'utf-8');
  }

  // Write composed pilot.md
  const pilotContent = composePilot(scale);
  writeFileSync(join(agentsDir, 'pilot.md'), pilotContent, 'utf-8');

  // Write builder.md and reviewer.md
  const builderContent = getTemplate('agents/builder.md');
  if (builderContent) {
    writeFileSync(join(agentsDir, 'builder.md'), builderContent, 'utf-8');
  }

  const reviewerContent = getTemplate('agents/reviewer.md');
  if (reviewerContent) {
    writeFileSync(join(agentsDir, 'reviewer.md'), reviewerContent, 'utf-8');
  }

  // Write issue/spec/PR templates
  const templateFiles = [
    'issue-feature.md',
    'issue-bug.md',
    'issue-hotfix.md',
    'issue-chore.md',
    'spec.md',
    'pr.md',
  ];

  for (const name of templateFiles) {
    const content = getTemplate(`templates/${name}`);
    if (content) {
      writeFileSync(join(templatesDir, name), content, 'utf-8');
    }
  }

  // Store checksums for upgrade detection
  const checksums = computeChecksums(versoDir);
  saveChecksums(versoDir, checksums);
}
