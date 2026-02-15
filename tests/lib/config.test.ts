import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseDocument } from 'yaml';
import {
  readYamlDocument,
  writeYamlDocument,
  applyWizardToConfig,
} from '../../src/lib/config.js';
import type { WizardAnswers } from '../../src/types/index.js';
import { SCALE_WIP_DEFAULTS } from '../../src/constants.js';

let tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'verso-test-config-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe('readYamlDocument', () => {
  it('parses a YAML file into a Document', async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, 'test.yaml');
    await writeFile(filePath, 'key: value\nnested:\n  foo: bar\n');

    const doc = await readYamlDocument(filePath);

    expect(doc.get('key')).toBe('value');
    expect(doc.getIn(['nested', 'foo'])).toBe('bar');
  });

  it('preserves comments in the document', async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, 'commented.yaml');
    const content = '# Top comment\nkey: value # inline comment\n';
    await writeFile(filePath, content);

    const doc = await readYamlDocument(filePath);
    const output = doc.toString();

    expect(output).toContain('# Top comment');
    expect(output).toContain('# inline comment');
  });

  it('throws when file does not exist', async () => {
    await expect(readYamlDocument('/nonexistent/file.yaml')).rejects.toThrow();
  });
});

describe('writeYamlDocument', () => {
  it('writes a document that can be read back', async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, 'roundtrip.yaml');

    const doc = parseDocument('scale: solo\nwip:\n  building: 2\n  pr_ready: 5\n');
    await writeYamlDocument(filePath, doc);

    const raw = await readFile(filePath, 'utf-8');
    expect(raw).toContain('scale: solo');
    expect(raw).toContain('building: 2');
  });

  it('preserves comments through write', async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, 'comments.yaml');

    const yamlWithComments = '# Config header\nscale: solo # team size\n';
    const doc = parseDocument(yamlWithComments);
    await writeYamlDocument(filePath, doc);

    const raw = await readFile(filePath, 'utf-8');
    expect(raw).toContain('# Config header');
    expect(raw).toContain('# team size');
  });
});

describe('applyWizardToConfig', () => {
  function makeAnswers(overrides: Partial<WizardAnswers> = {}): WizardAnswers {
    return {
      projectName: 'test-project',
      scale: 'solo',
      board: 'github',
      aiTool: 'claude',
      autonomy: 2,
      role: 'solo-dev',
      setupGitHub: false,
      ...overrides,
    };
  }

  it('sets scale correctly', () => {
    const doc = parseDocument('scale: solo\nautonomy:\n  feature: 1\nwip:\n  building: 1\n  pr_ready: 1\nboard:\n  provider: local\n');
    applyWizardToConfig(doc, makeAnswers({ scale: 'startup' }));

    expect(doc.get('scale')).toBe('startup');
  });

  it('sets WIP limits based on scale', () => {
    const doc = parseDocument('scale: solo\nautonomy:\n  feature: 1\nwip:\n  building: 1\n  pr_ready: 1\nboard:\n  provider: local\n');

    applyWizardToConfig(doc, makeAnswers({ scale: 'small-team' }));

    const expectedWip = SCALE_WIP_DEFAULTS['small-team'];
    expect(doc.getIn(['wip', 'building'])).toBe(expectedWip.building);
    expect(doc.getIn(['wip', 'pr_ready'])).toBe(expectedWip.pr_ready);
  });

  it('sets board provider', () => {
    const doc = parseDocument('scale: solo\nautonomy:\n  feature: 1\nwip:\n  building: 1\n  pr_ready: 1\nboard:\n  provider: local\n');
    applyWizardToConfig(doc, makeAnswers({ board: 'linear' }));

    expect(doc.getIn(['board', 'provider'])).toBe('linear');
  });

  it('sets autonomy for all work types', () => {
    const doc = parseDocument('scale: solo\nautonomy:\n  feature: 1\n  enhancement: 1\n  bug: 1\n  hotfix: 1\n  refactor: 1\n  chore: 1\nwip:\n  building: 1\n  pr_ready: 1\nboard:\n  provider: local\n');
    applyWizardToConfig(doc, makeAnswers({ autonomy: 3 }));

    expect(doc.getIn(['autonomy', 'feature'])).toBe(3);
    expect(doc.getIn(['autonomy', 'enhancement'])).toBe(3);
    expect(doc.getIn(['autonomy', 'bug'])).toBe(3);
    expect(doc.getIn(['autonomy', 'hotfix'])).toBe(3);
    expect(doc.getIn(['autonomy', 'refactor'])).toBe(3);
    expect(doc.getIn(['autonomy', 'chore'])).toBe(3);
  });

  it('preserves comments in the document after applying wizard', async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, 'config.yaml');

    const yamlContent = [
      '# VERSO Config',
      'scale: solo # team size',
      'autonomy:',
      '  feature: 2',
      '  enhancement: 2',
      '  bug: 3',
      '  hotfix: 3',
      '  refactor: 2',
      '  chore: 4',
      'wip:',
      '  building: 2 # max concurrent builds',
      '  pr_ready: 5',
      'board:',
      '  provider: github',
      '',
    ].join('\n');

    await writeFile(filePath, yamlContent);
    const doc = await readYamlDocument(filePath);
    applyWizardToConfig(doc, makeAnswers({ scale: 'enterprise', autonomy: 4, board: 'linear' }));
    await writeYamlDocument(filePath, doc);

    const result = await readFile(filePath, 'utf-8');
    expect(result).toContain('# VERSO Config');
    expect(result).toContain('# team size');
    expect(result).toContain('# max concurrent builds');
  });

  it('applies enterprise WIP defaults correctly', () => {
    const doc = parseDocument('scale: solo\nautonomy:\n  feature: 1\nwip:\n  building: 1\n  pr_ready: 1\nboard:\n  provider: local\n');
    applyWizardToConfig(doc, makeAnswers({ scale: 'enterprise' }));

    const expectedWip = SCALE_WIP_DEFAULTS['enterprise'];
    expect(doc.getIn(['wip', 'building'])).toBe(expectedWip.building);
    expect(doc.getIn(['wip', 'pr_ready'])).toBe(expectedWip.pr_ready);
  });
});
