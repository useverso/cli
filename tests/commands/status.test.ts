import { describe, it, expect } from 'vitest';

describe('status command', () => {
  it('can be imported without errors', async () => {
    const mod = await import('../../src/commands/status.js');
    expect(mod.statusCommand).toBeDefined();
    expect(typeof mod.statusCommand).toBe('function');
  });
});
