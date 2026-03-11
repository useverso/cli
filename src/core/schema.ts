import yaml from 'js-yaml';

import { SchemaError } from './error.js';

export const CURRENT_SCHEMA_VERSION = 2;

type MigrationFn = (content: string) => string;

interface Migration {
  fromVersion: number;
  toVersion: number;
  migrate: MigrationFn;
}

const DEFAULT_COSTS = {
  tokens_in: 0,
  tokens_out: 0,
  api_cost: 0,
  agent_wall_time: 0,
  dev_gate_time: 0,
  dev_review_time: 0,
};

function migrateV1toV2(content: string): string {
  const doc = yaml.load(content) as Record<string, unknown>;
  doc.schema_version = 2;

  const items = (doc.items ?? []) as Record<string, unknown>[];
  for (const item of items) {
    if (item.description === undefined) item.description = '';
    if (item.spec_path === undefined) item.spec_path = '';
    if (item.blocked_by === undefined) item.blocked_by = [];
    if (item.blocked_reason === undefined) item.blocked_reason = '';
    if (item.milestone === undefined) item.milestone = '';
    if (item.costs === undefined) item.costs = { ...DEFAULT_COSTS };
  }

  return yaml.dump(doc, { lineWidth: -1, noRefs: true });
}

function migrationRegistry(): Migration[] {
  return [{ fromVersion: 1, toVersion: 2, migrate: migrateV1toV2 }];
}

export function detectSchemaVersion(yamlContent: string): number {
  let value: unknown;
  try {
    value = yaml.load(yamlContent);
  } catch (e) {
    throw new SchemaError(`invalid YAML: ${e}`);
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SchemaError('expected YAML mapping at top level');
  }

  const mapping = value as Record<string, unknown>;
  if (!('schema_version' in mapping)) {
    return 0;
  }

  const version = mapping.schema_version;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    throw new SchemaError(`schema_version is not a valid integer: ${JSON.stringify(version)}`);
  }

  return version;
}

export function needsMigration(current: number, target: number): boolean {
  return current < target;
}

export function validateSchemaVersion(version: number): void {
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new SchemaError(
      `unknown schema version ${version} (max supported: ${CURRENT_SCHEMA_VERSION})`,
    );
  }
}

export function migrate(content: string, from: number, to: number): string {
  if (from === to) return content;

  const registry = migrationRegistry();
  let currentContent = content;
  let currentVersion = from;

  while (currentVersion < to) {
    const nextVersion = currentVersion + 1;
    const migration = registry.find(
      (m) => m.fromVersion === currentVersion && m.toVersion === nextVersion,
    );

    if (!migration) {
      throw new SchemaError(
        `no migration path from version ${currentVersion} to ${nextVersion}`,
      );
    }

    currentContent = migration.migrate(currentContent);
    currentVersion = nextVersion;
  }

  return currentContent;
}
