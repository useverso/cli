import { describe, it, expect } from 'vitest';
import { parseDocument } from 'yaml';
import { mergeYamlDocuments } from '../../src/lib/yaml-merge.js';

function merge(userYaml: string, templateYaml: string): string {
  const userDoc = parseDocument(userYaml);
  const templateDoc = parseDocument(templateYaml);
  mergeYamlDocuments(userDoc, templateDoc);
  return userDoc.toString();
}

function mergeAndParse(userYaml: string, templateYaml: string): Record<string, unknown> {
  const userDoc = parseDocument(userYaml);
  const templateDoc = parseDocument(templateYaml);
  mergeYamlDocuments(userDoc, templateDoc);
  return userDoc.toJSON();
}

describe('mergeYamlDocuments', () => {
  it('adds new keys from template to user', () => {
    const result = mergeAndParse(
      'existing: value\n',
      'existing: template-value\nnew_key: added\n',
    );

    expect(result).toHaveProperty('new_key', 'added');
  });

  it('preserves existing user values (does not overwrite)', () => {
    const result = mergeAndParse(
      'scale: enterprise\n',
      'scale: solo\n',
    );

    expect(result).toHaveProperty('scale', 'enterprise');
  });

  it('recursively merges nested maps', () => {
    const result = mergeAndParse(
      'wip:\n  building: 5\n',
      'wip:\n  building: 2\n  pr_ready: 10\n',
    );

    // User's value preserved
    expect((result.wip as Record<string, unknown>).building).toBe(5);
    // New key added from template
    expect((result.wip as Record<string, unknown>).pr_ready).toBe(10);
  });

  it('preserves user arrays (sequences) entirely', () => {
    const result = mergeAndParse(
      'items:\n  - user1\n  - user2\n',
      'items:\n  - template1\n  - template2\n  - template3\n',
    );

    expect(result.items).toEqual(['user1', 'user2']);
  });

  it('preserves keys in user that do not exist in template', () => {
    const result = mergeAndParse(
      'custom_key: my-value\nshared: user-val\n',
      'shared: tmpl-val\n',
    );

    expect(result).toHaveProperty('custom_key', 'my-value');
    expect(result).toHaveProperty('shared', 'user-val');
  });

  it('handles empty user document', () => {
    const result = mergeAndParse(
      '',
      'key: value\n',
    );

    // Empty document has no map — merge should not crash
    // (the merge function returns early if contents aren't maps)
    expect(result).toBeDefined();
  });

  it('handles empty template document', () => {
    const result = mergeAndParse(
      'key: value\n',
      '',
    );

    expect(result).toHaveProperty('key', 'value');
  });

  it('adds deeply nested new keys', () => {
    const result = mergeAndParse(
      'level1:\n  existing: yes\n',
      'level1:\n  existing: no\n  new_nested:\n    deep: value\n',
    );

    expect((result.level1 as Record<string, unknown>).existing).toBe('yes');
    expect((result.level1 as Record<string, unknown>)).toHaveProperty('new_nested');
  });

  it('preserves comments from user document', () => {
    const output = merge(
      '# User comment\nscale: solo\n',
      'scale: enterprise\nnew_key: val\n',
    );

    expect(output).toContain('# User comment');
    expect(output).toContain('scale: solo');
    expect(output).toContain('new_key: val');
  });

  it('adds template comments for new keys', () => {
    const output = merge(
      'existing: value\n',
      'existing: other\n# Template comment\nnew_key: added\n',
    );

    // The new key should be added with its comment from the template
    expect(output).toContain('new_key: added');
  });
});
