import { describe, expect, it, vi } from 'vitest';
import { checkCiGuard } from '../../src/core/state-machine.js';
import { CiCheckFailedError } from '../../src/core/error.js';
import { defaultConfig } from '../../src/core/config.js';
import type { VersoConfig } from '../../src/core/config.js';
import type { CiPlugin, PluginContext } from '../../src/core/plugin.js';

function makeCiPlugin(checks: { name: string; passed: boolean }[]): CiPlugin {
  return {
    meta: { name: 'test-ci', type: 'ci', version: '1.0.0' },
    getCheckStatus: vi.fn(async (_ctx: PluginContext, _branch: string) => checks),
  };
}

describe('checkCiGuard', () => {
  it('passes when no CI plugin is loaded', async () => {
    const config = defaultConfig();
    config.ci.block_transition = true;
    await expect(checkCiGuard('feat/test', config, null)).resolves.toBeUndefined();
  });

  it('passes when block_transition is false', async () => {
    const config = defaultConfig();
    config.ci.block_transition = false;
    const plugin = makeCiPlugin([{ name: 'tests', passed: false }]);
    await expect(checkCiGuard('feat/test', config, plugin)).resolves.toBeUndefined();
    // Plugin should not even be called
    expect(plugin.getCheckStatus).not.toHaveBeenCalled();
  });

  it('passes when all CI checks pass', async () => {
    const config = defaultConfig();
    config.ci.block_transition = true;
    const plugin = makeCiPlugin([
      { name: 'tests', passed: true },
      { name: 'lint', passed: true },
    ]);
    await expect(checkCiGuard('feat/test', config, plugin)).resolves.toBeUndefined();
    expect(plugin.getCheckStatus).toHaveBeenCalledOnce();
  });

  it('throws CiCheckFailedError when checks fail', async () => {
    const config = defaultConfig();
    config.ci.block_transition = true;
    const plugin = makeCiPlugin([
      { name: 'tests', passed: false },
      { name: 'lint', passed: true },
      { name: 'typecheck', passed: false },
    ]);
    await expect(checkCiGuard('feat/test', config, plugin, { itemId: 1 }))
      .rejects.toThrow(CiCheckFailedError);

    try {
      await checkCiGuard('feat/test', config, plugin, { itemId: 1 });
    } catch (e) {
      const err = e as CiCheckFailedError;
      expect(err.failedChecks).toEqual(['tests', 'typecheck']);
      expect(err.code).toBe('CI_CHECK_FAILED');
    }
  });

  it('passes the branch to the CI plugin', async () => {
    const config = defaultConfig();
    config.ci.block_transition = true;
    const plugin = makeCiPlugin([{ name: 'tests', passed: true }]);
    await checkCiGuard('feat/my-branch', config, plugin);
    expect(plugin.getCheckStatus).toHaveBeenCalledWith(
      expect.objectContaining({ config }),
      'feat/my-branch',
    );
  });
});
