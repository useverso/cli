import { describe, it, expect } from 'vitest';

import { computeMetrics } from '../../src/commands/metrics.js';
import { createDefaultItem } from '../../src/core/types.js';
import type { BoardItem } from '../../src/core/types.js';

function makeItem(overrides: Partial<BoardItem> = {}): BoardItem {
  return createDefaultItem(overrides);
}

describe('computeMetrics', () => {
  // ── empty board ──────────────────────────────────────
  it('handles empty board gracefully with zeros', () => {
    const result = computeMetrics([]);

    expect(result.throughput.done).toBe(0);
    expect(result.throughput.total).toBe(0);
    expect(result.throughput.percentage).toBe(0);
    expect(result.cycleTime.avgHours).toBe(0);
    expect(result.cycleTime.count).toBe(0);
    expect(result.agentEffort.totalSessions).toBe(0);
    expect(result.agentEffort.avgPerItem).toBe(0);
    expect(result.retryRate.totalRetries).toBe(0);
    expect(result.retryRate.itemsWithRetries).toBe(0);
    expect(result.retryRate.percentage).toBe(0);
    expect(result.reviewEfficiency.avgRoundsPerItem).toBe(0);
    expect(result.reviewEfficiency.escalationCount).toBe(0);
    expect(result.byWorkType).toEqual([]);
    expect(result.costs.totalTokensIn).toBe(0);
    expect(result.costs.totalApiCost).toBe(0);
  });

  // ── throughput calculation ───────────────────────────
  it('calculates throughput correctly', () => {
    const items = [
      makeItem({ id: 1, state: 'done', type: 'feature' }),
      makeItem({ id: 2, state: 'done', type: 'bug' }),
      makeItem({ id: 3, state: 'building', type: 'feature' }),
    ];

    const result = computeMetrics(items);

    expect(result.throughput.done).toBe(2);
    expect(result.throughput.total).toBe(3);
    expect(result.throughput.percentage).toBe(67);
  });

  // ── cycle time ───────────────────────────────────────
  it('calculates cycle time from transitions', () => {
    const items = [
      makeItem({
        id: 1,
        state: 'done',
        transitions: [
          {
            from: 'captured',
            to: 'refined',
            trigger: 'spec_written',
            actor: 'pilot',
            at: '2024-06-01T10:00:00Z',
          },
          {
            from: 'pr_ready',
            to: 'done',
            trigger: 'merged',
            actor: 'captain',
            at: '2024-06-01T12:00:00Z',
          },
        ],
      }),
      makeItem({
        id: 2,
        state: 'done',
        transitions: [
          {
            from: 'captured',
            to: 'refined',
            trigger: 'spec_written',
            actor: 'pilot',
            at: '2024-06-02T08:00:00Z',
          },
          {
            from: 'pr_ready',
            to: 'done',
            trigger: 'merged',
            actor: 'captain',
            at: '2024-06-02T12:00:00Z',
          },
        ],
      }),
    ];

    const result = computeMetrics(items);

    // Item 1: 2 hours, Item 2: 4 hours => avg 3 hours
    expect(result.cycleTime.avgHours).toBe(3);
    expect(result.cycleTime.count).toBe(2);
  });

  it('excludes non-done items from cycle time', () => {
    const items = [
      makeItem({
        id: 1,
        state: 'building',
        transitions: [
          {
            from: 'captured',
            to: 'building',
            trigger: 'start',
            actor: 'pilot',
            at: '2024-06-01T10:00:00Z',
          },
        ],
      }),
    ];

    const result = computeMetrics(items);

    expect(result.cycleTime.avgHours).toBe(0);
    expect(result.cycleTime.count).toBe(0);
  });

  // ── agent sessions aggregation ───────────────────────
  it('sums agent sessions correctly', () => {
    const items = [
      makeItem({ id: 1, agent_sessions: 3 }),
      makeItem({ id: 2, agent_sessions: 5 }),
      makeItem({ id: 3, agent_sessions: 2 }),
    ];

    const result = computeMetrics(items);

    expect(result.agentEffort.totalSessions).toBe(10);
    expect(result.agentEffort.avgPerItem).toBe(3.3);
  });

  // ── retry rate ───────────────────────────────────────
  it('counts items with retries', () => {
    const items = [
      makeItem({ id: 1, retries: 2 }),
      makeItem({ id: 2, retries: 0 }),
      makeItem({ id: 3, retries: 3 }),
      makeItem({ id: 4, retries: 0 }),
      makeItem({ id: 5, retries: 0 }),
      makeItem({ id: 6, retries: 1 }),
    ];

    const result = computeMetrics(items);

    expect(result.retryRate.totalRetries).toBe(6);
    expect(result.retryRate.itemsWithRetries).toBe(3);
    expect(result.retryRate.percentage).toBe(50);
  });

  // ── review rounds ────────────────────────────────────
  it('averages review rounds per item', () => {
    const review = (verdict: string) => ({
      verdict,
      criteria_met: '',
      summary: '',
      issues: [],
      at: '2024-06-01T00:00:00Z',
    });

    const items = [
      makeItem({
        id: 1,
        reviews: [review('changes_requested'), review('approved')],
      }),
      makeItem({
        id: 2,
        reviews: [review('approved')],
      }),
      makeItem({
        id: 3,
        reviews: [],
      }),
    ];

    const result = computeMetrics(items);

    // 3 total reviews across 2 items with reviews = 1.5
    expect(result.reviewEfficiency.avgRoundsPerItem).toBe(1.5);
    // 1 item has more than 1 review = 1 escalation
    expect(result.reviewEfficiency.escalationCount).toBe(1);
  });

  // ── by work type breakdown ───────────────────────────
  it('breaks down metrics by work type', () => {
    const review = {
      verdict: 'approved',
      criteria_met: '',
      summary: '',
      issues: [],
      at: '2024-06-01T00:00:00Z',
    };

    const items = [
      makeItem({ id: 1, type: 'feature', agent_sessions: 3, reviews: [review] }),
      makeItem({ id: 2, type: 'feature', agent_sessions: 5, reviews: [review, review] }),
      makeItem({ id: 3, type: 'bug', agent_sessions: 2, reviews: [review] }),
    ];

    const result = computeMetrics(items);

    expect(result.byWorkType).toHaveLength(2);

    const featureType = result.byWorkType.find((w) => w.type === 'feature');
    expect(featureType).toBeDefined();
    expect(featureType!.count).toBe(2);
    expect(featureType!.avgSessions).toBe(4); // (3+5)/2
    expect(featureType!.avgReviews).toBe(1.5); // (1+2)/2

    const bugType = result.byWorkType.find((w) => w.type === 'bug');
    expect(bugType).toBeDefined();
    expect(bugType!.count).toBe(1);
    expect(bugType!.avgSessions).toBe(2);
    expect(bugType!.avgReviews).toBe(1);
  });

  it('omits work types with zero items', () => {
    const items = [makeItem({ id: 1, type: 'feature' })];

    const result = computeMetrics(items);

    expect(result.byWorkType).toHaveLength(1);
    expect(result.byWorkType[0].type).toBe('feature');
  });

  // ── by state ─────────────────────────────────────────
  it('counts items per state correctly with mixed states', () => {
    const items = [
      makeItem({ id: 1, state: 'captured' }),
      makeItem({ id: 2, state: 'captured' }),
      makeItem({ id: 3, state: 'building' }),
      makeItem({ id: 4, state: 'done' }),
      makeItem({ id: 5, state: 'done' }),
      makeItem({ id: 6, state: 'done' }),
      makeItem({ id: 7, state: 'cancelled' }),
    ];

    const result = computeMetrics(items);

    expect(result.byState.captured).toBe(2);
    expect(result.byState.building).toBe(1);
    expect(result.byState.done).toBe(3);
    expect(result.byState.cancelled).toBe(1);
    expect(result.byState.refined).toBe(0);
    expect(result.byState.queued).toBe(0);
    expect(result.byState.verifying).toBe(0);
    expect(result.byState.pr_ready).toBe(0);
    expect(result.byState.blocked).toBe(0);
  });

  // ── costs aggregation ────────────────────────────────
  it('sums costs across all items', () => {
    const items = [
      makeItem({
        id: 1,
        costs: {
          tokens_in: 1000,
          tokens_out: 500,
          api_cost: 0.05,
          agent_wall_time: 120,
          dev_gate_time: 60,
          dev_review_time: 30,
        },
      }),
      makeItem({
        id: 2,
        costs: {
          tokens_in: 2000,
          tokens_out: 800,
          api_cost: 0.1,
          agent_wall_time: 180,
          dev_gate_time: 90,
          dev_review_time: 45,
        },
      }),
    ];

    const result = computeMetrics(items);

    expect(result.costs.totalTokensIn).toBe(3000);
    expect(result.costs.totalTokensOut).toBe(1300);
    expect(result.costs.totalApiCost).toBeCloseTo(0.15);
    expect(result.costs.totalAgentWallTime).toBe(300);
    expect(result.costs.totalDevGateTime).toBe(150);
    expect(result.costs.totalDevReviewTime).toBe(75);
  });
});
