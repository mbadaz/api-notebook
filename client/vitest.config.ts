import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Logic-only tests for now (no UI/component tests).
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
