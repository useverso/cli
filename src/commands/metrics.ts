import fs from 'node:fs';
import { Command } from 'commander';

import * as board from '../core/board.js';
import type { BoardItem, WorkType } from '../core/types.js';
import { ALL_STATES, ALL_WORK_TYPES } from '../core/types.js';
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

// --- Metrics types ---

export interface MetricsResult {
  throughput: { done: number; total: number; percentage: number };
  cycleTime: { avgHours: number; count: number };
  agentEffort: { totalSessions: number; avgPerItem: number };
  retryRate: { totalRetries: number; itemsWithRetries: number; percentage: number };
  reviewEfficiency: { avgRoundsPerItem: number; escalationCount: number };
  byState: Record<string, number>;
  byWorkType: Array<{
    type: string;
    count: number;
    avgSessions: number;
    avgReviews: number;
  }>;
  costs: {
    totalTokensIn: number;
    totalTokensOut: number;
    totalApiCost: number;
    totalAgentWallTime: number;
    totalDevGateTime: number;
    totalDevReviewTime: number;
  };
}

// --- Computation ---

export function computeMetrics(items: BoardItem[]): MetricsResult {
  const total = items.length;
  const done = items.filter((i) => i.state === 'done').length;
  const percentage = total > 0 ? Math.round((done / total) * 100) : 0;

  // Cycle time: average hours from first transition to the transition that lands on 'done'
  const doneItems = items.filter((i) => i.state === 'done' && i.transitions.length > 0);
  let cycleTimeSum = 0;
  let cycleTimeCount = 0;
  for (const item of doneItems) {
    const firstAt = item.transitions[0]?.at;
    const doneTransition = [...item.transitions].reverse().find((t) => t.to === 'done');
    if (firstAt && doneTransition) {
      const start = new Date(firstAt).getTime();
      const end = new Date(doneTransition.at).getTime();
      if (!isNaN(start) && !isNaN(end) && end >= start) {
        cycleTimeSum += (end - start) / (1000 * 60 * 60);
        cycleTimeCount++;
      }
    }
  }
  const avgHours = cycleTimeCount > 0 ? cycleTimeSum / cycleTimeCount : 0;

  // Agent effort
  const totalSessions = items.reduce((sum, i) => sum + i.agent_sessions, 0);
  const avgPerItem = total > 0 ? totalSessions / total : 0;

  // Retry rate
  const totalRetries = items.reduce((sum, i) => sum + i.retries, 0);
  const itemsWithRetries = items.filter((i) => i.retries > 0).length;
  const retryPercentage = total > 0 ? Math.round((itemsWithRetries / total) * 100) : 0;

  // Review efficiency
  const itemsWithReviews = items.filter((i) => i.reviews.length > 0);
  const totalReviews = items.reduce((sum, i) => sum + i.reviews.length, 0);
  const avgRoundsPerItem =
    itemsWithReviews.length > 0 ? totalReviews / itemsWithReviews.length : 0;
  const escalationCount = items.filter((i) => i.reviews.length > 1).length;

  // By state
  const byState: Record<string, number> = {};
  for (const state of ALL_STATES) {
    byState[state] = items.filter((i) => i.state === state).length;
  }

  // By work type
  const byWorkType: MetricsResult['byWorkType'] = [];
  for (const wt of ALL_WORK_TYPES) {
    const typeItems = items.filter((i) => i.type === wt);
    if (typeItems.length === 0) continue;
    const typeReviewItems = typeItems.filter((i) => i.reviews.length > 0);
    byWorkType.push({
      type: wt,
      count: typeItems.length,
      avgSessions:
        typeItems.length > 0
          ? typeItems.reduce((s, i) => s + i.agent_sessions, 0) / typeItems.length
          : 0,
      avgReviews:
        typeReviewItems.length > 0
          ? typeItems.reduce((s, i) => s + i.reviews.length, 0) / typeItems.length
          : 0,
    });
  }

  // Costs
  const costs = {
    totalTokensIn: items.reduce((s, i) => s + (i.costs?.tokens_in ?? 0), 0),
    totalTokensOut: items.reduce((s, i) => s + (i.costs?.tokens_out ?? 0), 0),
    totalApiCost: items.reduce((s, i) => s + (i.costs?.api_cost ?? 0), 0),
    totalAgentWallTime: items.reduce((s, i) => s + (i.costs?.agent_wall_time ?? 0), 0),
    totalDevGateTime: items.reduce((s, i) => s + (i.costs?.dev_gate_time ?? 0), 0),
    totalDevReviewTime: items.reduce((s, i) => s + (i.costs?.dev_review_time ?? 0), 0),
  };

  return {
    throughput: { done, total, percentage },
    cycleTime: { avgHours: parseFloat(avgHours.toFixed(2)), count: cycleTimeCount },
    agentEffort: {
      totalSessions,
      avgPerItem: parseFloat(avgPerItem.toFixed(1)),
    },
    retryRate: {
      totalRetries,
      itemsWithRetries,
      percentage: retryPercentage,
    },
    reviewEfficiency: {
      avgRoundsPerItem: parseFloat(avgRoundsPerItem.toFixed(1)),
      escalationCount,
    },
    byState,
    byWorkType,
    costs,
  };
}

// --- Output helpers ---

function hasCosts(m: MetricsResult): boolean {
  const c = m.costs;
  return (
    c.totalTokensIn > 0 ||
    c.totalTokensOut > 0 ||
    c.totalApiCost > 0 ||
    c.totalAgentWallTime > 0 ||
    c.totalDevGateTime > 0 ||
    c.totalDevReviewTime > 0
  );
}

function printHuman(m: MetricsResult): void {
  console.log(ui.heading('VERSO Metrics'));
  console.log(ui.dim('─'.repeat(40)));

  const t = m.throughput;
  console.log(`  Throughput:      ${t.done} done / ${t.total} total (${t.percentage}%)`);

  const ct = m.cycleTime;
  const cycleStr = ct.count > 0 ? `avg ${ct.avgHours}h (captured -> done)` : 'n/a';
  console.log(`  Cycle time:      ${cycleStr}`);

  const ae = m.agentEffort;
  console.log(`  Agent effort:    ${ae.totalSessions} sessions (avg ${ae.avgPerItem}/item)`);

  const rr = m.retryRate;
  console.log(
    `  Retry rate:      ${rr.totalRetries} retries across ${rr.itemsWithRetries} items (${rr.percentage}%)`,
  );

  const re = m.reviewEfficiency;
  const escLabel = re.escalationCount === 1 ? 'escalation' : 'escalations';
  console.log(
    `  Review rounds:   avg ${re.avgRoundsPerItem}/item, ${re.escalationCount} ${escLabel}`,
  );

  if (hasCosts(m)) {
    console.log();
    console.log(ui.heading('Costs:'));
    const c = m.costs;
    if (c.totalTokensIn) console.log(`  Tokens in:       ${c.totalTokensIn.toLocaleString()}`);
    if (c.totalTokensOut) console.log(`  Tokens out:      ${c.totalTokensOut.toLocaleString()}`);
    if (c.totalApiCost) console.log(`  API cost:        $${c.totalApiCost.toFixed(4)}`);
    if (c.totalAgentWallTime)
      console.log(`  Agent time:      ${c.totalAgentWallTime.toLocaleString()}s`);
    if (c.totalDevGateTime)
      console.log(`  Gate time:       ${c.totalDevGateTime.toLocaleString()}s`);
    if (c.totalDevReviewTime)
      console.log(`  Review time:     ${c.totalDevReviewTime.toLocaleString()}s`);
  }

  if (m.byWorkType.length > 0) {
    console.log();
    console.log(ui.heading('By Work Type:'));
    for (const wt of m.byWorkType) {
      const type = wt.type.padEnd(10);
      console.log(
        `  ${type} ${wt.count} items   avg ${wt.avgSessions.toFixed(1)} sessions   avg ${wt.avgReviews.toFixed(1)} reviews`,
      );
    }
  }
}

function printPlain(m: MetricsResult): void {
  console.log(`throughput_done: ${m.throughput.done}`);
  console.log(`throughput_total: ${m.throughput.total}`);
  console.log(`throughput_pct: ${m.throughput.percentage}`);
  console.log(`cycle_time_avg_hours: ${m.cycleTime.avgHours}`);
  console.log(`cycle_time_count: ${m.cycleTime.count}`);
  console.log(`agent_sessions_total: ${m.agentEffort.totalSessions}`);
  console.log(`agent_sessions_avg: ${m.agentEffort.avgPerItem}`);
  console.log(`retries_total: ${m.retryRate.totalRetries}`);
  console.log(`retries_items: ${m.retryRate.itemsWithRetries}`);
  console.log(`retries_pct: ${m.retryRate.percentage}`);
  console.log(`review_rounds_avg: ${m.reviewEfficiency.avgRoundsPerItem}`);
  console.log(`review_escalations: ${m.reviewEfficiency.escalationCount}`);
  for (const [state, count] of Object.entries(m.byState)) {
    console.log(`state_${state}: ${count}`);
  }
  for (const wt of m.byWorkType) {
    console.log(
      `type_${wt.type}: ${wt.count} avg_sessions=${wt.avgSessions.toFixed(1)} avg_reviews=${wt.avgReviews.toFixed(1)}`,
    );
  }
  const c = m.costs;
  console.log(`cost_tokens_in: ${c.totalTokensIn}`);
  console.log(`cost_tokens_out: ${c.totalTokensOut}`);
  console.log(`cost_api: ${c.totalApiCost}`);
  console.log(`cost_agent_wall_time: ${c.totalAgentWallTime}`);
  console.log(`cost_dev_gate_time: ${c.totalDevGateTime}`);
  console.log(`cost_dev_review_time: ${c.totalDevReviewTime}`);
}

// --- Command registration ---

export function registerMetricsCommand(program: Command): void {
  program
    .command('metrics')
    .description('Show aggregated cost and effort metrics')
    .option('--type <type>', 'Filter by work type (feature, bug, hotfix, refactor, chore)')
    .action(async (opts) => {
      const format = getFormat(program);
      const dir = versoDir();
      const boardFile = board.loadBoard(dir);

      const typeFilter = opts.type as WorkType | undefined;
      const items = typeFilter
        ? boardFile.items.filter((i) => i.type === typeFilter)
        : boardFile.items;

      const metrics = computeMetrics(items);

      switch (format) {
        case 'human':
          printHuman(metrics);
          break;
        case 'plain':
          printPlain(metrics);
          break;
        case 'json':
          console.log(JSON.stringify(metrics, null, 2));
          break;
      }
    });
}
