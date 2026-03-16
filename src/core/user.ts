import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

import type { UserConfig } from './types.js';

const USER_CONFIG_FILENAME = '.verso.yaml';

/**
 * Load user config from .verso.yaml in the project root.
 * Returns null if the file does not exist.
 */
export function loadUserConfig(projectDir: string): UserConfig | null {
  const filePath = path.join(projectDir, USER_CONFIG_FILENAME);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const contents = fs.readFileSync(filePath, 'utf-8');
  const loaded = yaml.load(contents) as UserConfig;
  if (!loaded || !loaded.user || !loaded.user.name || !loaded.user.id || !loaded.user.profile) {
    return null;
  }
  return loaded;
}

/**
 * Save user config to .verso.yaml in the project root.
 */
export function saveUserConfig(projectDir: string, config: UserConfig): void {
  const filePath = path.join(projectDir, USER_CONFIG_FILENAME);
  const content = yaml.dump(config, { lineWidth: -1, noRefs: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

export interface GhUserInfo {
  login: string;
  name: string;
  id: string;
}

/**
 * Try to get the user's identity from GitHub CLI (gh).
 * Returns null if gh is not installed or not authenticated.
 */
export function getGhUserInfo(): GhUserInfo | null {
  try {
    const { execSync } = require('node:child_process');
    const output = execSync('gh api user --jq "{login: .login, name: .name, id: .node_id}"', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const parsed = JSON.parse(output);
    if (!parsed.login) return null;
    return {
      login: parsed.login,
      name: parsed.name || '',
      id: parsed.id || '',
    };
  } catch {
    return null;
  }
}

/**
 * Try to get the user's name from git config.
 * Returns empty string if not available.
 */
export function getGitUserName(): string {
  try {
    const { execSync } = require('node:child_process');
    return execSync('git config user.name', { encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}

/**
 * Try to get the user's GitHub handle from git config.
 * Returns empty string if not available.
 */
export function getGitUserGithub(): string {
  try {
    const { execSync } = require('node:child_process');
    return execSync('git config user.github', { encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}

/**
 * Create a default UserConfig using git config values where available.
 */
export function createDefaultUserConfig(): UserConfig {
  // Priority: gh CLI > git config > manual defaults
  const ghInfo = getGhUserInfo();

  let name: string;
  let github: string;
  let id: string;

  if (ghInfo) {
    name = ghInfo.name || getGitUserName() || 'Developer';
    github = ghInfo.login;
    id = ghInfo.login;
  } else {
    name = getGitUserName() || 'Developer';
    github = getGitUserGithub();
    id = github || name.toLowerCase().replace(/\s+/g, '-');
  }

  const config: UserConfig = {
    user: {
      id,
      name,
      profile: 'solo-dev',
    },
    preferences: {
      format: 'human',
      autonomy_override: null,
    },
  };
  if (github) {
    config.user.github = github;
  }
  return config;
}
