import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.{ts,mjs}'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false
  }
});
