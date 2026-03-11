import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    target: 'node20',
    clean: true,
    sourcemap: true,
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
  {
    entry: ['src/plugin-api.ts'],
    format: ['esm'],
    target: 'node20',
    dts: true,
    sourcemap: true,
  },
]);
