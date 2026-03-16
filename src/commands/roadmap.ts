import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import yaml from 'js-yaml';

import type { OutputFormat } from '../output.js';
import * as ui from '../ui.js';

function getFormat(cmd: Command): OutputFormat {
  return cmd.optsWithGlobals().format ?? 'human';
}

function versoDir(): string {
  const dir = `${process.cwd()}/.verso`;
  if (!fs.existsSync(dir)) {
    console.error('.verso directory not found in current directory');
    process.exit(1);
  }
  return dir;
}

interface Criterion {
  id: string;
  description: string;
  status: string;
  issues: string[];
}

interface ExitCriterion {
  description: string;
  status: string;
}

interface Milestone {
  name: string;
  goal: string;
  status: string;
  started_at: string;
  completed_at: string;
  depends_on?: string[];
  criteria: Criterion[];
  exit_criteria: ExitCriterion[];
}

interface HorizonEntry {
  milestone: string;
  focus: string;
}

interface Roadmap {
  schema_version: number;
  vision: string;
  horizons: {
    now: HorizonEntry;
    next: HorizonEntry;
    later: string[];
  };
  milestones: Record<string, Milestone>;
}

function loadRoadmap(versoDir: string): Roadmap {
  const filePath = path.join(versoDir, 'roadmap.yaml');
  if (!fs.existsSync(filePath)) {
    console.error('roadmap.yaml not found in .verso directory');
    process.exit(1);
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  return yaml.load(raw) as Roadmap;
}

function printCriteriaStatus(status: string): string {
  switch (status) {
    case 'done':
      return ui.success(status);
    case 'in_progress':
      return ui.warn(status);
    default:
      return ui.dim(status);
  }
}

function printMilestoneStatus(status: string): string {
  switch (status) {
    case 'completed':
      return ui.success(status);
    case 'active':
      return ui.warn(status);
    default:
      return ui.dim(status);
  }
}

export function registerRoadmapCommand(program: Command): void {
  const roadmapCmd = program
    .command('roadmap')
    .description('Manage project roadmap and milestones');

  roadmapCmd
    .command('show')
    .description('Display roadmap and milestones')
    .action(() => {
      const format = getFormat(program);
      const dir = versoDir();
      const roadmap = loadRoadmap(dir);

      switch (format) {
        case 'json':
          console.log(JSON.stringify(roadmap, null, 2));
          break;

        case 'plain':
          console.log(`schema_version: ${roadmap.schema_version}`);
          console.log(`vision: ${roadmap.vision}`);
          console.log(`now_milestone: ${roadmap.horizons.now.milestone}`);
          console.log(`now_focus: ${roadmap.horizons.now.focus}`);
          console.log(`next_milestone: ${roadmap.horizons.next.milestone}`);
          console.log(`next_focus: ${roadmap.horizons.next.focus}`);
          if (Array.isArray(roadmap.horizons.later) && roadmap.horizons.later.length > 0) {
            console.log(`later: ${roadmap.horizons.later.join(', ')}`);
          } else {
            console.log('later:');
          }
          for (const [key, ms] of Object.entries(roadmap.milestones)) {
            console.log(`milestone_${key}_name: ${ms.name}`);
            console.log(`milestone_${key}_status: ${ms.status}`);
            console.log(`milestone_${key}_goal: ${ms.goal}`);
            if (ms.criteria && ms.criteria.length > 0) {
              for (const c of ms.criteria) {
                console.log(`milestone_${key}_criterion: ${c.id} [${c.status}] ${c.description}`);
              }
            }
            if (ms.exit_criteria && ms.exit_criteria.length > 0) {
              for (const ec of ms.exit_criteria) {
                console.log(`milestone_${key}_exit: [${ec.status}] ${ec.description}`);
              }
            }
          }
          break;

        case 'human': {
          console.log(ui.heading('VERSO Roadmap'));
          console.log();

          if (roadmap.vision) {
            console.log(`  Vision: ${roadmap.vision}`);
            console.log();
          }

          console.log(ui.heading('Horizons'));
          console.log();
          console.log(`  ${ui.success('NOW')}    ${roadmap.horizons.now.milestone}${roadmap.horizons.now.focus ? ` — ${roadmap.horizons.now.focus}` : ''}`);
          console.log(`  ${ui.warn('NEXT')}   ${roadmap.horizons.next.milestone}${roadmap.horizons.next.focus ? ` — ${roadmap.horizons.next.focus}` : ''}`);
          if (Array.isArray(roadmap.horizons.later) && roadmap.horizons.later.length > 0) {
            console.log(`  ${ui.dim('LATER')}  ${roadmap.horizons.later.join(', ')}`);
          } else {
            console.log(`  ${ui.dim('LATER')}  (none planned)`);
          }
          console.log();

          console.log(ui.heading('Milestones'));
          for (const [key, ms] of Object.entries(roadmap.milestones)) {
            console.log();
            console.log(`  ${ui.heading(ms.name)} (${key})  ${printMilestoneStatus(ms.status)}`);
            if (ms.goal) {
              console.log(`  ${ui.dim('Goal:')} ${ms.goal}`);
            }

            if (ms.criteria && ms.criteria.length > 0) {
              console.log();
              console.log(`  ${ui.dim('Criteria:')}`);
              for (const c of ms.criteria) {
                const statusStr = printCriteriaStatus(c.status);
                console.log(`    [${statusStr}] ${c.description || c.id}`);
              }
            }

            if (ms.exit_criteria && ms.exit_criteria.length > 0) {
              console.log();
              console.log(`  ${ui.dim('Exit criteria:')}`);
              for (const ec of ms.exit_criteria) {
                const statusStr = printCriteriaStatus(ec.status);
                console.log(`    [${statusStr}] ${ec.description}`);
              }
            }
          }
          console.log();
          break;
        }
      }
    });
}
