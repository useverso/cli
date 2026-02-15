import type { BoardProvider } from '../../types/index.js';
import type { BoardIntegration } from './interface.js';
import { LocalIntegration } from './local.js';
import { GitHubIntegration } from './github.js';
import { LinearIntegration } from './linear.js';

const integrations: Record<BoardProvider, () => BoardIntegration> = {
  local: () => new LocalIntegration(),
  github: () => new GitHubIntegration(),
  linear: () => new LinearIntegration(),
};

/**
 * Resolve a board provider name to its integration implementation.
 */
export function getIntegration(provider: BoardProvider): BoardIntegration {
  const factory = integrations[provider];
  if (!factory) {
    throw new Error(`Unknown board provider: ${provider}`);
  }
  return factory();
}
