import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import {
  ALL_STATES,
  ALL_WORK_TYPES,
  TERMINAL_STATES,
  boardFileToYaml,
  boardFileFromYaml,
  createDefaultItem,
} from '../../src/core/types.js';
import type {
  State,
  WorkType,
  BoardItem,
  BoardFile,
  DoctorCheck,
  CheckSeverity,
  ItemCosts,
} from '../../src/core/types.js';

// 1. pr_ready is a valid State value
describe('State', () => {
  it('pr_ready is a valid state', () => {
    const state: State = 'pr_ready';
    expect(state).toBe('pr_ready');
  });

  // 2. ALL_STATES contains all 9 states
  it('ALL_STATES contains all 9 states', () => {
    expect(ALL_STATES).toHaveLength(9);
    expect(ALL_STATES).toContain('pr_ready');
    expect(ALL_STATES).toContain('captured');
    expect(ALL_STATES).toContain('done');
  });

  // 3. All State variants roundtrip through YAML
  it('all variants roundtrip through YAML', () => {
    for (const state of ALL_STATES) {
      const yamlStr = yaml.dump(state);
      const back = yaml.load(yamlStr) as string;
      expect(back).toBe(state);
    }
  });

  // 10. Display equivalent
  it('displays as snake_case strings', () => {
    const prReady: State = 'pr_ready';
    const captured: State = 'captured';
    const building: State = 'building';
    expect(`${prReady}`).toBe('pr_ready');
    expect(`${captured}`).toBe('captured');
    expect(`${building}`).toBe('building');
  });

  it('TERMINAL_STATES contains done and cancelled', () => {
    expect(TERMINAL_STATES).toEqual(['done', 'cancelled']);
  });
});

// 4. All WorkType variants roundtrip through YAML
describe('WorkType', () => {
  it('all variants roundtrip through YAML', () => {
    for (const wt of ALL_WORK_TYPES) {
      const yamlStr = yaml.dump(wt);
      const back = yaml.load(yamlStr) as string;
      expect(back).toBe(wt);
    }
  });

  it('displays as snake_case strings', () => {
    const feature: WorkType = 'feature';
    const bug: WorkType = 'bug';
    const hotfix: WorkType = 'hotfix';
    expect(`${feature}`).toBe('feature');
    expect(`${bug}`).toBe('bug');
    expect(`${hotfix}`).toBe('hotfix');
  });
});

// 5. small-team is a valid Scale
describe('Scale', () => {
  it('small-team is kebab-case', () => {
    expect('small-team').toBe('small-team');
  });
});

// 6. Empty string is valid Complexity (None)
describe('Complexity', () => {
  it('empty string represents None', () => {
    const none: '' = '';
    expect(none).toBe('');
  });
});

// 7. BoardItem full roundtrip through YAML
describe('BoardItem', () => {
  it('full roundtrip through YAML', () => {
    const item: BoardItem = {
      id: 42,
      title: 'Add auth flow',
      type: 'feature',
      state: 'building',
      assignee: 'builder',
      autonomy: 2,
      branch: 'feat/auth',
      pr: '',
      retries: 0,
      complexity: 'medium',
      agent_sessions: 3,
      created_at: '2026-01-15T10:00:00Z',
      updated_at: '2026-01-16T14:30:00Z',
      labels: ['auth', 'core'],
      transitions: [
        {
          from: 'queued',
          to: 'building',
          trigger: 'start_build',
          actor: 'pilot',
          at: '2026-01-16T14:30:00Z',
        },
      ],
      reviews: [
        {
          verdict: 'approve',
          criteria_met: 'all',
          summary: 'Looks good',
          issues: [],
          at: '2026-01-16T15:00:00Z',
        },
      ],
      external: {},
    };

    const board: BoardFile = { schema_version: 1, items: [item] };
    const yamlStr = boardFileToYaml(board);
    const back = boardFileFromYaml(yamlStr);
    expect(back.items[0].id).toBe(42);
    expect(back.items[0].title).toBe('Add auth flow');
    expect(back.items[0].type).toBe('feature');
    expect(back.items[0].state).toBe('building');
    expect(back.items[0].assignee).toBe('builder');
    expect(back.items[0].autonomy).toBe(2);
    expect(back.items[0].complexity).toBe('medium');
    expect(back.items[0].labels).toEqual(['auth', 'core']);
    expect(back.items[0].transitions).toHaveLength(1);
    expect(back.items[0].reviews).toHaveLength(1);
  });

  // 9. Minimal BoardItem deserializes with defaults
  it('deserializes with defaults for optional fields', () => {
    const yamlStr = 'schema_version: 1\nitems:\n  - id: 1\n    type: bug\n    state: captured\n';
    const board = boardFileFromYaml(yamlStr);
    const item = board.items[0];
    expect(item.id).toBe(1);
    expect(item.type).toBe('bug');
    expect(item.state).toBe('captured');
    expect(item.title).toBe('');
    expect(item.assignee).toBe('');
    expect(item.autonomy).toBe(0);
    expect(item.branch).toBe('');
    expect(item.pr).toBe('');
    expect(item.retries).toBe(0);
    expect(item.complexity).toBe('');
    expect(item.agent_sessions).toBe(0);
    expect(item.labels).toEqual([]);
    expect(item.transitions).toEqual([]);
    expect(item.reviews).toEqual([]);
    expect(item.external).toEqual({});
  });
});

// 8. BoardFile roundtrip
describe('BoardFile', () => {
  it('roundtrips through YAML', () => {
    const board: BoardFile = {
      schema_version: 1,
      items: [
        createDefaultItem({
          id: 1,
          type: 'feature',
          state: 'captured',
          title: 'First item',
          autonomy: 1,
        }),
      ],
    };

    const yamlStr = boardFileToYaml(board);
    const back = boardFileFromYaml(yamlStr);
    expect(back.schema_version).toBe(1);
    expect(back.items).toHaveLength(1);
    expect(back.items[0].id).toBe(1);
    expect(back.items[0].title).toBe('First item');
  });

  it('empty items deserializes correctly', () => {
    const yamlStr = 'schema_version: 2\n';
    const board = boardFileFromYaml(yamlStr);
    expect(board.schema_version).toBe(2);
    expect(board.items).toEqual([]);
  });
});

// CheckSeverity roundtrip
describe('CheckSeverity', () => {
  it('all variants roundtrip through YAML', () => {
    const severities: CheckSeverity[] = ['pass', 'warn', 'fail'];
    for (const sev of severities) {
      const yamlStr = yaml.dump(sev);
      const back = yaml.load(yamlStr) as string;
      expect(back).toBe(sev);
    }
  });
});

// DoctorCheck roundtrip
describe('DoctorCheck', () => {
  it('roundtrips through YAML', () => {
    const check: DoctorCheck = {
      name: 'board_exists',
      severity: 'pass',
      message: 'board.yaml found',
    };
    const yamlStr = yaml.dump(check);
    const back = yaml.load(yamlStr) as DoctorCheck;
    expect(back.name).toBe(check.name);
    expect(back.severity).toBe(check.severity);
    expect(back.message).toBe(check.message);
  });
});

// BoardItem new fields
describe('BoardItem new fields', () => {
  it('createDefaultItem sets description to empty string', () => {
    const item = createDefaultItem();
    expect(item.description).toBe('');
  });

  it('createDefaultItem sets spec_path to empty string', () => {
    const item = createDefaultItem();
    expect(item.spec_path).toBe('');
  });

  it('createDefaultItem sets blocked_by to empty array', () => {
    const item = createDefaultItem();
    expect(item.blocked_by).toEqual([]);
  });

  it('createDefaultItem sets blocked_reason to empty string', () => {
    const item = createDefaultItem();
    expect(item.blocked_reason).toBe('');
  });

  it('createDefaultItem sets milestone to empty string', () => {
    const item = createDefaultItem();
    expect(item.milestone).toBe('');
  });

  it('createDefaultItem sets costs with all zeros', () => {
    const item = createDefaultItem();
    expect(item.costs).toEqual({
      tokens_in: 0,
      tokens_out: 0,
      api_cost: 0,
      agent_wall_time: 0,
      dev_gate_time: 0,
      dev_review_time: 0,
    });
  });

  it('new fields roundtrip through YAML', () => {
    const item = createDefaultItem({
      id: 99,
      title: 'Test new fields',
      type: 'feature',
      state: 'queued',
      description: 'A detailed description of the feature',
      spec_path: '.verso/specs/99-test.md',
      blocked_by: [10, 20],
      blocked_reason: 'Waiting on auth module',
      milestone: 'v1.0',
      costs: {
        tokens_in: 1500,
        tokens_out: 3000,
        api_cost: 0.12,
        agent_wall_time: 45,
        dev_gate_time: 10,
        dev_review_time: 5,
      },
    });

    const board: BoardFile = { schema_version: 1, items: [item] };
    const yamlStr = boardFileToYaml(board);
    const back = boardFileFromYaml(yamlStr);
    const restored = back.items[0];

    expect(restored.description).toBe('A detailed description of the feature');
    expect(restored.spec_path).toBe('.verso/specs/99-test.md');
    expect(restored.blocked_by).toEqual([10, 20]);
    expect(restored.blocked_reason).toBe('Waiting on auth module');
    expect(restored.milestone).toBe('v1.0');
    expect(restored.costs.tokens_in).toBe(1500);
    expect(restored.costs.tokens_out).toBe(3000);
    expect(restored.costs.api_cost).toBe(0.12);
    expect(restored.costs.agent_wall_time).toBe(45);
    expect(restored.costs.dev_gate_time).toBe(10);
    expect(restored.costs.dev_review_time).toBe(5);
  });

  it('deserializes v1 items (missing new fields) with defaults', () => {
    const yamlStr = `schema_version: 1
items:
  - id: 5
    title: Legacy item
    type: feature
    state: captured
`;
    const board = boardFileFromYaml(yamlStr);
    const item = board.items[0];

    expect(item.id).toBe(5);
    expect(item.title).toBe('Legacy item');
    expect(item.description).toBe('');
    expect(item.spec_path).toBe('');
    expect(item.blocked_by).toEqual([]);
    expect(item.blocked_reason).toBe('');
    expect(item.milestone).toBe('');
    expect(item.costs).toEqual({
      tokens_in: 0,
      tokens_out: 0,
      api_cost: 0,
      agent_wall_time: 0,
      dev_gate_time: 0,
      dev_review_time: 0,
    });
  });
});
