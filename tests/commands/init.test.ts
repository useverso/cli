import { describe, it, expect } from 'vitest';

describe('init command', () => {
  it('can be imported without errors', async () => {
    const mod = await import('../../src/commands/init.js');
    expect(mod.initCommand).toBeDefined();
    expect(typeof mod.initCommand).toBe('function');
  });
});
