// Direct export for programmatic use
export { createBoardPlugin } from './board.js';

// Named export for VERSO plugin loader (mod[expectedType])
export { createBoardPlugin as board } from './board.js';

// Re-export utilities
export { resolveLinearConfig, createClient, resolveApiKey, type LinearConfig } from './client.js';
export * from './labels.js';
