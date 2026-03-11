import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  detectSchemaVersion,
  needsMigration,
  validateSchemaVersion,
  migrate,
} from '../../src/core/schema.js';
import { SchemaError } from '../../src/core/error.js';

// 1. detect version 1
describe('detectSchemaVersion', () => {
  it('finds version 1', () => {
    expect(detectSchemaVersion('schema_version: 1\nitems: []')).toBe(1);
  });

  // 2. returns 0 when missing
  it('returns 0 when schema_version missing', () => {
    expect(detectSchemaVersion('items: []')).toBe(0);
  });

  // 3. errors on non-mapping
  it('errors on non-mapping YAML', () => {
    expect(() => detectSchemaVersion('- item1\n- item2')).toThrow(SchemaError);
  });
});

// 4-6. needsMigration
describe('needsMigration', () => {
  it('true when current < target', () => {
    expect(needsMigration(0, 1)).toBe(true);
  });

  it('v1 needs migration to v2', () => {
    expect(needsMigration(1, 2)).toBe(true);
  });

  it('v2 does not need migration', () => {
    expect(needsMigration(2, 2)).toBe(false);
  });

  it('false when equal', () => {
    expect(needsMigration(1, 1)).toBe(false);
  });

  it('false when current > target', () => {
    expect(needsMigration(2, 1)).toBe(false);
  });
});

// 7-9. validateSchemaVersion
describe('validateSchemaVersion', () => {
  it('CURRENT_SCHEMA_VERSION is 2', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(2);
  });

  it('version 2 validates', () => {
    expect(() => validateSchemaVersion(2)).not.toThrow();
  });

  it('version 1 succeeds', () => {
    expect(() => validateSchemaVersion(1)).not.toThrow();
  });

  it('version 0 succeeds', () => {
    expect(() => validateSchemaVersion(0)).not.toThrow();
  });

  it('version 99 fails', () => {
    expect(() => validateSchemaVersion(99)).toThrow(SchemaError);
  });
});

// 10-11. migrate
describe('migrate', () => {
  it('same version returns content unchanged', () => {
    const content = 'schema_version: 1\nitems: []';
    expect(migrate(content, 1, 1)).toBe(content);
  });

  it('missing migration returns error', () => {
    expect(() => migrate('items: []', 0, 1)).toThrow(SchemaError);
  });
});

// v1 to v2 migration
describe('v1 to v2 migration', () => {
  it('adds new fields with defaults to items', () => {
    const v1Content = `schema_version: 1\nitems:\n  - id: 1\n    title: "Test"\n    type: feature\n    state: captured\n`;
    const migrated = migrate(v1Content, 1, 2);
    const parsed = yaml.load(migrated) as Record<string, unknown>;
    expect(parsed.schema_version).toBe(2);
    const item = parsed.items[0];
    expect(item.id).toBe(1);
    expect(item.title).toBe('Test');
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

  it('preserves existing fields during migration', () => {
    const v1Content = `schema_version: 1\nitems:\n  - id: 42\n    title: "Keep"\n    type: bug\n    state: building\n    assignee: builder\n    retries: 2\n`;
    const migrated = migrate(v1Content, 1, 2);
    const parsed = yaml.load(migrated) as Record<string, unknown>;
    expect(parsed.schema_version).toBe(2);
    const item = parsed.items[0];
    expect(item.id).toBe(42);
    expect(item.title).toBe('Keep');
    expect(item.type).toBe('bug');
    expect(item.state).toBe('building');
    expect(item.assignee).toBe('builder');
    expect(item.retries).toBe(2);
    // New defaults also present
    expect(item.description).toBe('');
    expect(item.costs.tokens_in).toBe(0);
  });

  it('handles empty items array', () => {
    const v1Content = 'schema_version: 1\nitems: []\n';
    const migrated = migrate(v1Content, 1, 2);
    const parsed = yaml.load(migrated) as Record<string, unknown>;
    expect(parsed.schema_version).toBe(2);
    expect(parsed.items).toEqual([]);
  });

  it('does not overwrite existing v2 fields', () => {
    const v1Content = `schema_version: 1\nitems:\n  - id: 5\n    title: "Has desc"\n    type: feature\n    state: captured\n    description: "Already has one"\n    milestone: "v1.0"\n`;
    const migrated = migrate(v1Content, 1, 2);
    const parsed = yaml.load(migrated) as Record<string, unknown>;
    const item = parsed.items[0];
    expect(item.description).toBe('Already has one');
    expect(item.milestone).toBe('v1.0');
  });
});
