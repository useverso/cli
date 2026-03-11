// Direct exports for programmatic use
export { createBoardPlugin } from './board.js';
export { createReviewPlugin } from './review.js';
export { createCiPlugin } from './ci.js';
export { createDeployPlugin } from './deploy.js';

// Named exports for VERSO plugin loader (mod[expectedType])
export { createBoardPlugin as board } from './board.js';
export { createReviewPlugin as review } from './review.js';
export { createCiPlugin as ci } from './ci.js';
export { createDeployPlugin as deploy } from './deploy.js';

// Re-export utilities
export { resolveGitHubConfig, createClient, resolveToken, detectRepoFromGit, type GitHubConfig } from './client.js';
export * from './labels.js';
