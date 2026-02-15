import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { DoctorCheck, VersoConfig } from '../types/index.js';
import { VERSO_DIR, VERSO_YAML, REQUIRED_FILES, PILOT_MODULE_FOR_ROLE } from '../constants.js';
import { ui, handleError } from '../lib/ui.js';
import { getTemplatesDir } from '../lib/templates.js';
import { isGhAvailable, isGhAuthenticated } from '../lib/github.js';
import { readChecksums } from '../lib/checksums.js';

const YAML_FILES = [
  'config.yaml',
  'roadmap.yaml',
  'state-machine.yaml',
  'releases.yaml',
];

export async function doctorCommand(): Promise<void> {
  try {
    const projectRoot = process.cwd();
    const checks: DoctorCheck[] = [];

    ui.heading('VERSO Doctor');

    // 1. .verso/ directory exists
    const versoDirPath = join(projectRoot, VERSO_DIR);
    const versoDirExists = existsSync(versoDirPath);

    if (versoDirExists) {
      checks.push({ name: 'verso-dir', severity: 'pass', message: '.verso/ directory exists' });
    } else {
      checks.push({ name: 'verso-dir', severity: 'fail', message: '.verso/ directory not found' });
      printResults(checks);
      process.exit(1);
    }

    // 2. Required files present
    const missingFiles: string[] = [];
    for (const file of REQUIRED_FILES) {
      if (!existsSync(join(projectRoot, file))) {
        missingFiles.push(file);
      }
    }

    if (missingFiles.length === 0) {
      checks.push({ name: 'required-files', severity: 'pass', message: 'All required files present' });
    } else {
      for (const file of missingFiles) {
        checks.push({ name: 'required-files', severity: 'fail', message: `Missing required file: ${file}` });
      }
    }

    // 3. YAML files parse correctly
    let yamlParseOk = true;
    let parsedConfig: VersoConfig | null = null;

    for (const file of YAML_FILES) {
      const filePath = join(projectRoot, VERSO_DIR, file);
      if (!existsSync(filePath)) {
        // Already reported in required files check — skip parse
        continue;
      }
      try {
        const raw = await readFile(filePath, 'utf-8');
        const parsed = parse(raw);
        if (file === 'config.yaml' && parsed) {
          parsedConfig = parsed as VersoConfig;
        }
      } catch {
        checks.push({ name: 'yaml-parse', severity: 'fail', message: `Failed to parse ${VERSO_DIR}/${file}` });
        yamlParseOk = false;
      }
    }

    if (yamlParseOk) {
      checks.push({ name: 'yaml-parse', severity: 'pass', message: 'YAML files parse correctly' });
    }

    // 4. Config completeness
    if (parsedConfig) {
      const configIssues: string[] = [];

      if (!parsedConfig.scale) {
        configIssues.push('config.yaml: `scale` is not set');
      }

      if (!parsedConfig.autonomy || typeof parsedConfig.autonomy !== 'object' || Object.keys(parsedConfig.autonomy).length === 0) {
        configIssues.push('config.yaml: `autonomy` section is missing or empty');
      }

      if (!parsedConfig.wip || parsedConfig.wip.building == null || parsedConfig.wip.pr_ready == null) {
        configIssues.push('config.yaml: `wip` must have `building` and `pr_ready` fields');
      }

      if (!parsedConfig.board || !parsedConfig.board.provider) {
        configIssues.push('config.yaml: `board.provider` is not set');
      }

      if (configIssues.length === 0) {
        checks.push({ name: 'config-completeness', severity: 'pass', message: 'Config completeness checks passed' });
      } else {
        for (const issue of configIssues) {
          checks.push({ name: 'config-completeness', severity: 'fail', message: issue });
        }
      }
    }

    // 5. .verso.yaml exists (personal config, optional)
    const versoYamlPath = join(projectRoot, VERSO_YAML);
    const versoYamlExists = existsSync(versoYamlPath);

    if (versoYamlExists) {
      checks.push({ name: 'verso-yaml', severity: 'pass', message: '.verso.yaml found' });
    } else {
      checks.push({ name: 'verso-yaml', severity: 'warn', message: '.verso.yaml not found (personal config)' });
    }

    // 6. .verso.yaml in .gitignore
    const gitignorePath = join(projectRoot, '.gitignore');
    let isGitignored = false;

    if (existsSync(gitignorePath)) {
      try {
        const gitignoreContent = await readFile(gitignorePath, 'utf-8');
        const lines = gitignoreContent.split('\n').map(l => l.trim());
        isGitignored = lines.some(line => line === VERSO_YAML || line === `/${VERSO_YAML}`);
      } catch {
        // Unable to read .gitignore — treat as not gitignored
      }
    }

    if (isGitignored) {
      checks.push({ name: 'gitignore', severity: 'pass', message: '.verso.yaml is gitignored' });
    } else {
      checks.push({ name: 'gitignore', severity: 'warn', message: '.verso.yaml is not in .gitignore' });
    }

    // 7. gh CLI checks (only if board provider is github)
    const boardProvider = parsedConfig?.board?.provider;

    if (boardProvider === 'github') {
      const ghAvailable = await isGhAvailable();

      if (ghAvailable) {
        checks.push({ name: 'gh-available', severity: 'pass', message: 'gh CLI is installed' });

        const ghAuthed = await isGhAuthenticated();
        if (ghAuthed) {
          checks.push({ name: 'gh-auth', severity: 'pass', message: 'gh CLI is authenticated' });
        } else {
          checks.push({ name: 'gh-auth', severity: 'fail', message: 'gh CLI is not authenticated (run `gh auth login`)' });
        }
      } else {
        checks.push({ name: 'gh-available', severity: 'fail', message: 'gh CLI is not installed (https://cli.github.com)' });
      }
    }

    // 8. Checksums manifest valid
    const manifest = await readChecksums(projectRoot);

    if (manifest && manifest.version && manifest.files) {
      checks.push({ name: 'checksums', severity: 'pass', message: 'Checksums manifest is valid' });
    } else {
      checks.push({ name: 'checksums', severity: 'warn', message: 'Checksums manifest missing or invalid (.verso/.checksums.json)' });
    }

    // 9. Pilot template modules valid (core.md + at least one role variant)
    try {
      const templatesDir = getTemplatesDir();
      const pilotDir = join(templatesDir, '.verso', 'agents', 'pilot');
      const coreExists = existsSync(join(pilotDir, 'core.md'));
      const roleModules = Object.values(PILOT_MODULE_FOR_ROLE);
      const hasAtLeastOneRole = roleModules.some(mod => existsSync(join(pilotDir, mod)));

      if (coreExists && hasAtLeastOneRole) {
        checks.push({ name: 'pilot-templates', severity: 'pass', message: 'Pilot template modules valid (core + role variants)' });
      } else {
        if (!coreExists) {
          checks.push({ name: 'pilot-templates', severity: 'fail', message: 'Missing pilot/core.md in CLI templates' });
        }
        if (!hasAtLeastOneRole) {
          checks.push({ name: 'pilot-templates', severity: 'fail', message: 'No pilot role modules found in CLI templates' });
        }
      }
    } catch {
      checks.push({ name: 'pilot-templates', severity: 'warn', message: 'Could not verify pilot template modules' });
    }

    // Print results and summary
    printResults(checks);

    const failures = checks.filter(c => c.severity === 'fail').length;
    process.exit(failures > 0 ? 1 : 0);
  } catch (error) {
    handleError(error);
  }
}

function printResults(checks: DoctorCheck[]): void {
  for (const check of checks) {
    switch (check.severity) {
      case 'pass':
        ui.success(check.message);
        break;
      case 'warn':
        ui.warn(check.message);
        break;
      case 'fail':
        ui.error(check.message);
        break;
    }
  }

  const passed = checks.filter(c => c.severity === 'pass').length;
  const warnings = checks.filter(c => c.severity === 'warn').length;
  const failures = checks.filter(c => c.severity === 'fail').length;

  ui.blank();
  ui.info(`${passed} passed, ${warnings} warning${warnings !== 1 ? 's' : ''}, ${failures} failed`);
  ui.blank();
}
