import { existsSync } from 'node:fs';
import { cp, readFile, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { select, input, confirm } from '@inquirer/prompts';
import type { Scale, Role, AiTool, BoardProvider, WizardAnswers } from '../types/index.js';

const execFileAsync = promisify(execFileCb);
import {
  VERSO_DIR,
  VERSO_YAML,
  VERSO_YAML_EXAMPLE,
  SCALE_LABELS,
  AUTONOMY_LABELS,
  AI_TOOL_LABELS,
  ROLE_LABELS,
} from '../constants.js';
import { ui, VersoError, handleError } from '../lib/ui.js';
import { detectProjectName, isGitRepo } from '../lib/detect.js';
import { getTemplatesDir } from '../lib/templates.js';
import { readYamlDocument, writeYamlDocument, applyWizardToConfig } from '../lib/config.js';
import { generateChecksums, writeChecksums } from '../lib/checksums.js';
import { generateBridges } from '../lib/bridges.js';
import { isGhAvailable, isGhAuthenticated, hasProjectScope, copyVersoProject, getRepoSlug, createGitHubRepo, getGitHubOrgs } from '../lib/github.js';

export async function initCommand(): Promise<void> {
  try {
    const projectRoot = process.cwd();

    ui.heading('Initializing VERSO...');

    // --- Preflight checks ---

    // Check if .verso/ already exists
    if (existsSync(join(projectRoot, VERSO_DIR))) {
      throw new VersoError(
        '.verso/ already exists in this directory. Use `verso upgrade` to update templates.'
      );
    }

    // Check git repo — offer to initialize if missing
    let gitRepo = await isGitRepo(projectRoot);
    if (!gitRepo) {
      const initGit = await confirm({
        message: 'Not a git repository. Initialize one?',
        default: true,
      });

      if (initGit) {
        await execFileAsync('git', ['init'], { cwd: projectRoot });
        ui.success('Initialized git repository');
        gitRepo = true;
      } else {
        ui.warn('Continuing without git. Some features may not work.');
      }
      ui.blank();
    }

    // --- Detect project context ---
    const detectedName = await detectProjectName(projectRoot);

    // --- Interactive wizard ---

    const projectName = await input({
      message: 'Project name:',
      default: detectedName,
    });

    const scale = await select<Scale>({
      message: 'Team scale:',
      choices: (Object.entries(SCALE_LABELS) as [Scale, string][]).map(([value, name]) => ({
        value,
        name,
      })),
    });

    const board = await select<BoardProvider>({
      message: 'Board provider:',
      choices: [
        { value: 'github' as const, name: 'GitHub Projects' },
        { value: 'linear' as const, name: 'Linear' },
        { value: 'local' as const, name: 'Local YAML' },
      ],
    });

    const aiTool = await select<AiTool>({
      message: 'AI coding tool:',
      choices: (Object.entries(AI_TOOL_LABELS) as [AiTool, string][]).map(([value, name]) => ({
        value,
        name,
      })),
    });

    const autonomy = await select<number>({
      message: 'Default autonomy level:',
      choices: Object.entries(AUTONOMY_LABELS).map(([key, name]) => ({
        value: Number(key),
        name,
      })),
      default: 2,
    });

    // Role question — only ask if not solo
    let role: Role;
    if (scale === 'solo') {
      role = 'solo-dev';
    } else {
      // For team scales, ask the role (exclude solo-dev)
      role = await select<Role>({
        message: "What's your role?",
        choices: [
          { value: 'team-dev' as const, name: ROLE_LABELS['team-dev'] },
          { value: 'tech-lead' as const, name: ROLE_LABELS['tech-lead'] },
          { value: 'pm' as const, name: ROLE_LABELS['pm'] },
        ],
      });
    }

    // GitHub Project question (only if board is github)
    let setupGitHub = false;
    if (board === 'github') {
      setupGitHub = await confirm({
        message: 'Set up GitHub Project board?',
        default: true,
      });
    }

    const answers: WizardAnswers = {
      projectName,
      scale,
      board,
      aiTool,
      autonomy,
      role,
      setupGitHub,
    };

    ui.blank();

    // --- Copy template files ---
    const templatesDir = getTemplatesDir();
    const spinner = ui.spinner('Copying template files...');

    // Copy .verso/ directory
    await cp(join(templatesDir, VERSO_DIR), join(projectRoot, VERSO_DIR), { recursive: true });
    spinner.succeed('  Created .verso/ directory');

    // --- Apply wizard answers to config.yaml ---
    const configPath = join(projectRoot, VERSO_DIR, 'config.yaml');
    const configDoc = await readYamlDocument(configPath);
    applyWizardToConfig(configDoc, answers);
    await writeYamlDocument(configPath, configDoc);
    ui.success('Applied configuration');

    // --- Create .verso.yaml (personal, gitignored) ---
    // Copy .verso.yaml.example as the starting point, then set the role
    const examplePath = join(templatesDir, VERSO_YAML_EXAMPLE);
    if (existsSync(examplePath)) {
      const exampleContent = await readFile(examplePath, 'utf-8');
      // Replace the role placeholder with the actual role
      const personalConfig = exampleContent.replace(
        /role:\s*.*/,
        `role: ${answers.role}`
      );
      await writeFile(join(projectRoot, VERSO_YAML), personalConfig, 'utf-8');
    } else {
      // Minimal fallback
      await writeFile(
        join(projectRoot, VERSO_YAML),
        `# Personal VERSO config (gitignored)\nrole: ${answers.role}\n`,
        'utf-8'
      );
    }
    ui.success('Created .verso.yaml (your personal config)');

    // Copy .verso.yaml.example to project root for team onboarding
    if (existsSync(examplePath)) {
      await cp(examplePath, join(projectRoot, VERSO_YAML_EXAMPLE));
      ui.success('Created .verso.yaml.example (team template)');
    }

    // --- Generate checksums ---
    const checksums = await generateChecksums(projectRoot);
    await writeChecksums(projectRoot, checksums);
    ui.success('Generated checksums');

    // --- Generate bridge files ---
    const bridgeFiles = await generateBridges(projectRoot, answers.aiTool, answers.role);
    for (const file of bridgeFiles) {
      ui.success(`Generated ${file}`);
    }

    // --- Update .gitignore ---
    await updateGitignore(projectRoot);
    ui.success('Updated .gitignore');

    // --- GitHub Project (optional) ---
    if (answers.setupGitHub && gitRepo) {
      // Ensure gh CLI is available and authenticated before proceeding
      if (!(await isGhAvailable())) {
        ui.warn('gh CLI not installed — skipping GitHub Project setup');
      } else if (!(await isGhAuthenticated())) {
        ui.warn('gh CLI not authenticated — run `gh auth login` first');
      } else if (!(await hasProjectScope())) {
        ui.warn("Missing 'project' scope — run `gh auth refresh -s project` and try again");
      } else {
        // Check if there's a GitHub remote — if not, offer to create one
        const repoSlug = await getRepoSlug(projectRoot);

        if (!repoSlug) {
          const createRepo = await confirm({
            message: 'No GitHub remote found. Create a GitHub repository?',
            default: true,
          });

          if (createRepo) {
            // Let user choose the repository name
            const repoName = await input({
              message: 'Repository name:',
              default: answers.projectName,
            });

            // Let user choose the organization (or personal account)
            const orgs = await getGitHubOrgs();
            let fullRepoName = repoName;

            if (orgs.length > 0) {
              const owner = await select<string>({
                message: 'Create under:',
                choices: [
                  { value: '', name: 'Personal account' },
                  ...orgs.map(org => ({ value: org, name: org })),
                ],
              });
              if (owner) {
                fullRepoName = `${owner}/${repoName}`;
              }
            }

            // Make initial commit (gh repo create --source needs at least one commit)
            const commitSpinner = ui.spinner('Creating initial commit...');
            try {
              await execFileAsync('git', ['add', '-A'], { cwd: projectRoot });
              await execFileAsync('git', ['commit', '-m', 'chore: initialize project with VERSO'], { cwd: projectRoot });
              commitSpinner.succeed('  Created initial commit');
            } catch {
              commitSpinner.warn('  Could not create initial commit');
            }

            // Create the repo
            const repoSpinner = ui.spinner('Creating GitHub repository...');
            const result = await createGitHubRepo(fullRepoName, projectRoot);
            if (result.url) {
              repoSpinner.succeed(`  Created repository: ${result.url}`);
            } else {
              repoSpinner.warn(`  Could not create repository: ${result.error}`);
            }
          }
        }

        // Try creating the project board (re-check slug in case repo was just created)
        const currentSlug = await getRepoSlug(projectRoot);
        if (currentSlug) {
          const targetOwner = currentSlug.split('/')[0];

          const ghSpinner = ui.spinner('Copying VERSO project board...');
          const result = await copyVersoProject(
            `${answers.projectName} — VERSO`,
            targetOwner,
          );

          if (result.url) {
            ghSpinner.succeed(`  Created project board: ${result.url}`);

            // Write board details back to config.yaml
            if (result.number) {
              const updatedConfigDoc = await readYamlDocument(configPath);
              updatedConfigDoc.setIn(['board', 'github', 'owner'], targetOwner);
              updatedConfigDoc.setIn(['board', 'github', 'project_number'], result.number);
              await writeYamlDocument(configPath, updatedConfigDoc);

              // Update checksums since config changed
              const updatedChecksums = await generateChecksums(projectRoot);
              await writeChecksums(projectRoot, updatedChecksums);
            }
          } else {
            ghSpinner.warn(`  Could not create project board: ${result.error}`);
          }
        } else {
          ui.warn('No GitHub remote available — skipping project board setup');
        }
      }
    } else if (answers.setupGitHub && !gitRepo) {
      ui.warn('No git repository — skipping GitHub Project setup');
    }

    // --- Print success ---
    ui.blank();
    ui.heading('VERSO initialized successfully!');

    console.log('  Created:');
    console.log('    .verso/              Framework config and agent prompts');
    console.log('    .verso.yaml          Your personal config (gitignored)');
    console.log('    .verso.yaml.example  Template for team onboarding');
    for (const file of bridgeFiles) {
      const desc = getBridgeDescription(file);
      console.log(`    ${file.padEnd(21)}${desc}`);
    }

    ui.blank();
    console.log('  Next steps:');
    console.log('    1. Edit .verso/roadmap.yaml — set your vision and first milestone');
    console.log('    2. Edit .verso.yaml — fill in your name and GitHub handle');
    console.log('    3. Commit the .verso/ directory');
    console.log('    4. Start talking to your AI tool — the Pilot will take it from here');
    ui.blank();

  } catch (error) {
    if (error instanceof VersoError) {
      handleError(error);
    }
    // If user cancels prompt (Ctrl+C), exit gracefully
    if (error && typeof error === 'object' && 'name' in error) {
      const e = error as { name: string };
      if (e.name === 'ExitPromptError') {
        ui.blank();
        ui.info('Init cancelled.');
        process.exit(0);
      }
    }
    handleError(error);
  }
}

/**
 * Add .verso.yaml to .gitignore if not already present.
 */
async function updateGitignore(projectRoot: string): Promise<void> {
  const gitignorePath = join(projectRoot, '.gitignore');

  let content = '';
  try {
    content = await readFile(gitignorePath, 'utf-8');
  } catch {
    // No .gitignore — create one
  }

  const linesToAdd: string[] = [];

  if (!content.includes(VERSO_YAML)) {
    linesToAdd.push(VERSO_YAML);
  }

  if (linesToAdd.length > 0) {
    const section = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
    const addition = `${section}\n# VERSO personal config\n${linesToAdd.join('\n')}\n`;
    await appendFile(gitignorePath, addition, 'utf-8');
  }
}

/**
 * Get a human-readable description for a bridge file.
 */
function getBridgeDescription(file: string): string {
  if (file === 'AGENTS.md') return 'AI tool bridge (standard)';
  if (file === 'CLAUDE.md') return 'Pilot instructions (Claude Code)';
  if (file === '.claude/agents/builder.md') return 'Builder subagent (Claude Code)';
  if (file === '.claude/agents/reviewer.md') return 'Reviewer subagent (Claude Code)';
  if (file.startsWith('.claude/')) return 'Agent definitions';
  if (file === 'GEMINI.md') return 'AI tool bridge (Gemini CLI)';
  if (file.includes('.cursor/')) return 'AI tool bridge (Cursor)';
  if (file.includes('.windsurf/')) return 'AI tool bridge (Windsurf)';
  if (file.includes('.clinerules/')) return 'AI tool bridge (Cline)';
  return 'AI tool bridge';
}
