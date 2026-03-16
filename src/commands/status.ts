import fs from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import yaml from 'js-yaml';

import * as board from '../core/board.js';
import { loadConfig } from '../core/config.js';
import { loadAllPlugins } from '../core/plugin-loader.js';
import { createPluginContext } from '../core/plugin.js';
import { ALL_STATES } from '../core/types.js';
import type { State } from '../core/types.js';
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

function loadRoadmap(versoDir: string): Record<string, unknown> | null {
  const roadmapPath = join(versoDir, 'roadmap.yaml');
  if (!fs.existsSync(roadmapPath)) return null;
  const content = fs.readFileSync(roadmapPath, 'utf-8');
  return yaml.load(content) as Record<string, unknown>;
}

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show project status overview')
    .action(async () => {
      const format = getFormat(program);
      const dir = versoDir();
      const boardFile = board.loadBoard(dir);
      const cfg = loadConfig(dir);
      const roadmap = loadRoadmap(dir);

      const total = boardFile.items.length;
      const done = board.countInState(boardFile, 'done');
      const cancelled = board.countInState(boardFile, 'cancelled');
      const building = board.countInState(boardFile, 'building');
      const prReady = board.countInState(boardFile, 'pr_ready');

      // Compute counts per state
      const counts: Record<string, number> = {};
      for (const state of ALL_STATES) {
        counts[state] = board.countInState(boardFile, state);
      }

      // Collect active items (building + verifying)
      const activeItems = boardFile.items
        .filter((item) => item.state === 'building' || item.state === 'verifying')
        .map((item) => ({
          id: item.id,
          title: item.title,
          state: item.state,
          ...(item.assignee ? { assignee: item.assignee } : {}),
        }));

      // Collect blocked items with reasons
      const blockedItems = boardFile.items
        .filter((item) => item.state === 'blocked')
        .map((item) => ({
          id: item.id,
          title: item.title,
          reason: item.blocked_reason,
        }));

      // Collect plugin status info
      const pluginStatusEntries: { label: string; details: string[] }[] = [];
      try {
        const plugins = await loadAllPlugins(cfg, process.cwd());
        const ctx = createPluginContext(dir, cfg, boardFile);
        for (const plugin of Object.values(plugins)) {
          if (plugin && typeof plugin.statusInfo === 'function') {
            try {
              const info = await plugin.statusInfo(ctx);
              pluginStatusEntries.push(info);
            } catch {
              // Plugin statusInfo failed — skip silently
            }
          }
        }
      } catch {
        // Plugin loading failed — continue without plugin status
      }

      switch (format) {
        case 'human':
          console.log(ui.heading('VERSO Project Status'));
          console.log();
          console.log(`  Total items:     ${total}`);
          console.log(`  Completed:       ${done}`);
          console.log(`  Cancelled:       ${cancelled}`);
          console.log(`  Active:          ${total - done - cancelled}`);
          console.log();
          console.log(ui.heading('Items by state:'));
          for (const state of ALL_STATES) {
            if (counts[state] > 0) {
              console.log(`  ${ui.stateColor(state)}${' '.repeat(Math.max(0, 14 - state.length))} ${counts[state]}`);
            }
          }
          console.log();
          console.log(ui.heading('WIP limits:'));
          console.log(
            `  Building:  ${building} / ${cfg.wip.building} ${building >= cfg.wip.building ? ui.warn('(at limit)') : ''}`,
          );
          console.log(
            `  PR Ready:  ${prReady} / ${cfg.wip.pr_ready} ${prReady >= cfg.wip.pr_ready ? ui.warn('(at limit)') : ''}`,
          );
          if (activeItems.length > 0) {
            console.log();
            console.log(ui.heading('Active items:'));
            for (const item of activeItems) {
              const assigneePart = 'assignee' in item ? ` (${item.assignee})` : '';
              console.log(`  #${item.id} ${item.title} [${ui.stateColor(item.state as State)}]${assigneePart}`);
            }
          }
          if (blockedItems.length > 0) {
            console.log();
            console.log(ui.heading('Blocked items:'));
            for (const item of blockedItems) {
              console.log(`  #${item.id} ${item.title} — ${ui.warn(item.reason)}`);
            }
          }
          for (const entry of pluginStatusEntries) {
            console.log();
            console.log(ui.heading(entry.label));
            for (const detail of entry.details) {
              console.log(`  ${detail}`);
            }
          }
          break;
        case 'plain':
          console.log(`total: ${total}`);
          console.log(`done: ${done}`);
          console.log(`cancelled: ${cancelled}`);
          console.log(`active: ${total - done - cancelled}`);
          for (const state of ALL_STATES) {
            console.log(`${state}: ${counts[state]}`);
          }
          console.log(`wip_building: ${building}/${cfg.wip.building}`);
          console.log(`wip_pr_ready: ${prReady}/${cfg.wip.pr_ready}`);
          if (activeItems.length > 0) {
            for (const item of activeItems) {
              const assigneePart = 'assignee' in item ? ` assignee=${item.assignee}` : '';
              console.log(`active_item: #${item.id} ${item.title} [${item.state}]${assigneePart}`);
            }
          }
          if (blockedItems.length > 0) {
            for (const item of blockedItems) {
              console.log(`blocked_item: #${item.id} ${item.title} reason="${item.reason}"`);
            }
          }
          for (const entry of pluginStatusEntries) {
            console.log(`plugin_${entry.label}: ${entry.details.join(', ')}`);
          }
          // Config fields
          console.log(`config_scale: ${cfg.scale}`);
          for (const [wt, level] of Object.entries(cfg.autonomy)) {
            console.log(`config_autonomy_${wt}: ${level}`);
          }
          console.log(`config_quality_security_gate: ${cfg.quality.security_gate}`);
          console.log(`config_quality_accessibility_gate: ${cfg.quality.accessibility_gate}`);
          console.log(`config_quality_min_coverage: ${cfg.quality.min_coverage}`);
          console.log(`config_quality_require_tests: ${cfg.quality.require_tests}`);
          console.log(`config_ci_block_transition: ${cfg.ci.block_transition}`);
          console.log(`config_ci_required_checks: ${cfg.ci.required_checks.join(',')}`);
          console.log(`config_board_provider: ${cfg.board.provider}`);
          console.log(`config_review_max_rounds: ${cfg.review.max_rounds}`);
          console.log(`config_build_max_retries: ${cfg.build.max_retries}`);
          console.log(`config_debt_target_ratio: ${cfg.debt.target_ratio}`);
          console.log(`config_costs_enabled: ${cfg.costs.enabled}`);
          // Roadmap fields
          if (roadmap) {
            console.log(`roadmap_vision: ${roadmap.vision ?? ''}`);
            const horizons = roadmap.horizons as Record<string, unknown> | undefined;
            if (horizons) {
              const now = horizons.now as Record<string, unknown> | undefined;
              console.log(`roadmap_now: ${now?.milestone ?? ''}`);
              const next = horizons.next as Record<string, unknown> | undefined;
              console.log(`roadmap_next: ${next?.milestone ?? ''}`);
            }
          }
          break;
        case 'json': {
          const result = {
            total,
            done,
            cancelled,
            counts,
            active: activeItems,
            blocked: blockedItems,
            wip: {
              building: { current: building, max: cfg.wip.building },
              pr_ready: { current: prReady, max: cfg.wip.pr_ready },
            },
            config: {
              scale: cfg.scale,
              autonomy: cfg.autonomy,
              quality: cfg.quality,
              ci: cfg.ci,
              incidents: cfg.incidents,
              costs: cfg.costs,
              board: cfg.board,
              review: cfg.review,
              build: cfg.build,
              debt: cfg.debt,
            },
            roadmap: roadmap || undefined,
            plugins: pluginStatusEntries.length > 0
              ? pluginStatusEntries.reduce((acc, e) => {
                  acc[e.label] = e.details;
                  return acc;
                }, {} as Record<string, string[]>)
              : undefined,
          };
          console.log(JSON.stringify(result, null, 2));
          break;
        }
      }
    });
}
