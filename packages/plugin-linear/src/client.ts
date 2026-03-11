import { LinearClient } from '@linear/sdk';

export interface LinearConfig {
  api_key: string;
  team_id: string;
  project_id?: string;
  state_map?: Record<string, string>;
}

/**
 * Resolve the API key from environment variable or config.
 * Priority: VERSO_LINEAR_API_KEY env var > config.linear.api_key
 */
export function resolveApiKey(config: LinearConfig): string {
  const envKey = process.env.VERSO_LINEAR_API_KEY;
  if (envKey) return envKey;

  if (config.api_key) return config.api_key;

  throw new Error(
    'Linear API key not found. Set VERSO_LINEAR_API_KEY environment variable or configure linear.api_key in config.',
  );
}

/**
 * Resolve Linear config from the VERSO config object.
 */
export function resolveLinearConfig(config: Record<string, unknown>): LinearConfig {
  const linear = config.linear as Record<string, unknown> | undefined;

  if (!linear) {
    throw new Error('Missing linear configuration section in config.');
  }

  const api_key = (linear.api_key as string) || '';
  const team_id = linear.team_id as string;
  const project_id = linear.project_id as string | undefined;
  const state_map = linear.state_map as Record<string, string> | undefined;

  if (!team_id) {
    throw new Error('linear.team_id is required in config.');
  }

  return { api_key, team_id, project_id, state_map };
}

/**
 * Create a configured Linear SDK client.
 */
export function createClient(config: LinearConfig): LinearClient {
  const apiKey = resolveApiKey(config);
  return new LinearClient({ apiKey });
}
