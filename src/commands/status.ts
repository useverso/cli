import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import chalk from 'chalk';
import type { VersoConfig, VersoUserConfig } from '../types/index.js';
import {
  VERSO_DIR,
  VERSO_YAML,
  SCALE_LABELS,
  AUTONOMY_LABELS,
  ROLE_LABELS,
} from '../constants.js';
import { ui, VersoError, handleError } from '../lib/ui.js';

interface RoadmapHorizon {
  milestone: string;
  focus?: string;
}

interface MilestoneDefinition {
  name: string;
  goal?: string;
  depends_on?: string[];
  criteria?: Array<{ id: string; description: string; issues?: string[] }>;
  exit_criteria?: string[];
}

interface Roadmap {
  vision?: string;
  horizons?: {
    now?: RoadmapHorizon;
    next?: RoadmapHorizon;
    later?: string[];
  };
  milestones?: Record<string, MilestoneDefinition>;
}

export async function statusCommand(): Promise<void> {
  try {
    const projectRoot = process.cwd();

    // Preflight: .verso/ must exist
    if (!existsSync(join(projectRoot, VERSO_DIR))) {
      throw new VersoError('.verso/ not found. Run `verso init` first.');
    }

    ui.heading('VERSO Status');

    // --- Read config.yaml ---
    const configPath = join(projectRoot, VERSO_DIR, 'config.yaml');
    let config: VersoConfig;

    try {
      const raw = await readFile(configPath, 'utf-8');
      config = parse(raw) as VersoConfig;
    } catch {
      throw new VersoError('Could not parse .verso/config.yaml');
    }

    // -- Project info --
    const scale = config.scale || 'unknown';
    const scaleLabel = SCALE_LABELS[scale as keyof typeof SCALE_LABELS] || scale;
    console.log(`  ${chalk.bold('Scale:')}     ${scaleLabel}`);

    // Board
    const boardProvider = config.board?.provider || 'not set';
    const boardProject = config.board?.project;
    const boardLine = boardProject ? `${boardProvider} (${boardProject})` : boardProvider;
    console.log(`  ${chalk.bold('Board:')}     ${boardLine}`);

    // WIP limits
    const wipBuilding = config.wip?.building ?? '\u2014';
    const wipPrReady = config.wip?.pr_ready ?? '\u2014';
    console.log(`  ${chalk.bold('WIP:')}       building: ${wipBuilding}, pr_ready: ${wipPrReady}`);

    // Debt policy
    if (config.debt) {
      const ratio = config.debt.target_ratio != null
        ? `${Math.round(config.debt.target_ratio * 100)}%`
        : '\u2014';
      const trigger = config.debt.audit_trigger || '\u2014';
      console.log(`  ${chalk.bold('Debt:')}      target ${ratio}, audit on ${trigger}`);
    }

    // Cost tracking
    if (config.costs) {
      const costStatus = config.costs.enabled ? 'enabled' : 'disabled';
      console.log(`  ${chalk.bold('Costs:')}     ${costStatus}`);
    }

    ui.blank();

    // --- Autonomy levels ---
    console.log(`  ${chalk.bold('Autonomy:')}`);
    const autonomy = config.autonomy;

    if (autonomy && typeof autonomy === 'object') {
      for (const [workType, level] of Object.entries(autonomy)) {
        const levelNum = level as number;
        const levelLabel = AUTONOMY_LABELS[levelNum] || `${levelNum}`;
        console.log(`    ${workType.padEnd(14)} ${levelLabel}`);
      }
    } else {
      ui.info('  No autonomy configuration found');
    }

    ui.blank();

    // --- Roadmap ---
    const roadmapPath = join(projectRoot, VERSO_DIR, 'roadmap.yaml');

    if (existsSync(roadmapPath)) {
      try {
        const raw = await readFile(roadmapPath, 'utf-8');
        const roadmap = parse(raw) as Roadmap;

        console.log(`  ${chalk.bold('Roadmap:')}`);

        // Vision
        if (roadmap?.vision) {
          console.log(`    Vision: ${roadmap.vision}`);
          ui.blank();
        }

        // Horizons
        const horizons = roadmap?.horizons;

        if (horizons) {
          for (const horizon of ['now', 'next', 'later'] as const) {
            const value = horizons[horizon];

            if (horizon === 'later') {
              // Later is an array of milestone names
              const laterItems = value as string[] | undefined;
              if (Array.isArray(laterItems) && laterItems.length > 0) {
                console.log(`    ${chalk.bold('LATER:')}`);
                for (const item of laterItems) {
                  console.log(`      \u25CB ${item}`);
                }
              }
            } else {
              // Now and Next are objects with milestone + focus
              const horizonObj = value as RoadmapHorizon | undefined;
              if (horizonObj?.milestone) {
                const label = horizon.toUpperCase();
                const milestone = horizonObj.milestone;
                const focus = horizonObj.focus || '';
                const focusSuffix = focus ? ` \u2014 ${focus}` : '';
                console.log(`    ${chalk.bold(`${label}:`)}   ${milestone}${focusSuffix}`);
              }
            }
          }
        }

        // Milestones detail
        if (roadmap?.milestones && Object.keys(roadmap.milestones).length > 0) {
          ui.blank();
          console.log(`  ${chalk.bold('Milestones:')}`);

          for (const [key, ms] of Object.entries(roadmap.milestones)) {
            const name = ms.name || key;
            const goal = ms.goal ? ` \u2014 ${ms.goal}` : '';
            const deps = ms.depends_on?.length ? ` (depends on: ${ms.depends_on.join(', ')})` : '';
            console.log(`    ${chalk.bold(name)}${goal}${deps}`);

            // Criteria count
            const criteriaCount = ms.criteria?.length || 0;
            const definedCriteria = ms.criteria?.filter(c => c.description).length || 0;
            if (criteriaCount > 0) {
              console.log(`      Criteria: ${definedCriteria}/${criteriaCount} defined`);
            }

            // Exit criteria
            if (ms.exit_criteria?.length) {
              console.log(`      Exit criteria: ${ms.exit_criteria.length} defined`);
            }
          }
        }
      } catch {
        ui.warn('Could not parse roadmap.yaml');
      }
    } else {
      ui.warn('roadmap.yaml not found');
    }

    ui.blank();

    // --- Personal config (.verso.yaml) ---
    const personalPath = join(projectRoot, VERSO_YAML);

    if (existsSync(personalPath)) {
      try {
        const raw = await readFile(personalPath, 'utf-8');
        const personal = parse(raw) as Partial<VersoUserConfig>;

        if (personal) {
          console.log(`  ${chalk.bold('You:')}`);

          if (personal.role) {
            const roleLabel = ROLE_LABELS[personal.role as keyof typeof ROLE_LABELS] || personal.role;
            console.log(`    Role:     ${roleLabel}`);
          }
          if (personal.name) {
            console.log(`    Name:     ${personal.name}`);
          }
          if (personal.github) {
            console.log(`    GitHub:   ${personal.github}`);
          }
          if (personal.preferred_autonomy_override != null) {
            const overrideLabel = AUTONOMY_LABELS[personal.preferred_autonomy_override] || `${personal.preferred_autonomy_override}`;
            console.log(`    Override: ${overrideLabel}`);
          }
        }
      } catch {
        ui.warn('Could not parse .verso.yaml');
      }
    } else {
      ui.warn('.verso.yaml not found \u2014 create it from .verso.yaml.example');
    }

    ui.blank();
  } catch (error) {
    handleError(error);
  }
}
