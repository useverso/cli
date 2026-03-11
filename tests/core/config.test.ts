import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  defaultConfig,
  configForScale,
  loadConfig,
  saveConfig,
} from '../../src/core/config.js';
import type { VersoConfig } from '../../src/core/config.js';

// 1. default_config has schema_version 2
describe('defaultConfig', () => {
  it('has schema_version 2', () => {
    expect(defaultConfig().schema_version).toBe(2);
  });

  // 2. correct autonomy levels
  it('has correct autonomy levels', () => {
    const config = defaultConfig();
    expect(config.autonomy.feature).toBe(2);
    expect(config.autonomy.bug).toBe(3);
    expect(config.autonomy.hotfix).toBe(3);
    expect(config.autonomy.refactor).toBe(2);
    expect(config.autonomy.chore).toBe(4);
  });

  // 3. wip limits
  it('has wip building=2, pr_ready=5', () => {
    const config = defaultConfig();
    expect(config.wip.building).toBe(2);
    expect(config.wip.pr_ready).toBe(5);
  });

  // 4. review max_rounds
  it('has review max_rounds=3', () => {
    expect(defaultConfig().review.max_rounds).toBe(3);
  });

  // 5. quality workflow_mode
  it('has quality.workflow_mode = "default"', () => {
    expect(defaultConfig().quality.workflow_mode).toBe('default');
  });

  it('defaultConfig includes build.max_retries = 3', () => {
    const cfg = defaultConfig();
    expect(cfg.build.max_retries).toBe(3);
  });
});

// 6. YAML roundtrip
describe('YAML serialization', () => {
  it('roundtrip preserves all fields', () => {
    const config = defaultConfig();
    const yamlStr = yaml.dump(config, { lineWidth: -1, noRefs: true });
    const back = yaml.load(yamlStr) as VersoConfig;
    expect(back).toEqual(config);
  });
});

// 7-9. load/save config
describe('load/save config', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verso-config-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads from valid YAML file', () => {
    const config = defaultConfig();
    const yamlStr = yaml.dump(config, { lineWidth: -1, noRefs: true });
    fs.writeFileSync(path.join(tmpDir, 'config.yaml'), yamlStr);
    const loaded = loadConfig(tmpDir);
    expect(loaded).toEqual(config);
  });

  it('missing file returns defaults', () => {
    const loaded = loadConfig(tmpDir);
    expect(loaded).toEqual(defaultConfig());
  });

  it('save then load roundtrips', () => {
    const config = defaultConfig();
    saveConfig(tmpDir, config);
    const loaded = loadConfig(tmpDir);
    expect(loaded).toEqual(config);
  });
});

// 10. Different scales
describe('configForScale', () => {
  it('different scales have different WIP limits', () => {
    const solo = configForScale('solo');
    expect(solo.wip.building).toBe(2);
    expect(solo.wip.pr_ready).toBe(5);
    expect(solo.scale).toBe('solo');

    const enterprise = configForScale('enterprise');
    expect(enterprise.wip.building).toBe(5);
    expect(enterprise.wip.pr_ready).toBe(15);
    expect(enterprise.scale).toBe('enterprise');

    const smallTeam = configForScale('small-team');
    expect(smallTeam.wip.building).toBe(3);
    expect(smallTeam.wip.pr_ready).toBe(8);

    const startup = configForScale('startup');
    expect(startup.wip.building).toBe(4);
    expect(startup.wip.pr_ready).toBe(10);
  });
});
