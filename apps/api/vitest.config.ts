import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts', 'src/**/*.module.ts', 'src/**/*.spec.ts', 'src/**/*.test.ts'],
    },
  },
  resolve: {
    alias: {
      '@sms/shared': fileURLToPath(new URL('./../../packages/shared/dist/index.js', import.meta.url)),
    },
  },
});
