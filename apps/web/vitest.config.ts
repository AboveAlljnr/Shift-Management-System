import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts(x)', 'src/**/*.test.ts(x)'],
    globals: true,
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      '@sms/shared': fileURLToPath(new URL('./../../packages/shared/dist/index.js', import.meta.url)),
    },
  },
});