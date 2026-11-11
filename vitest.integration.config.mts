import { defineConfig } from 'vitest/config'

// Integration tests: a real PostgreSQL database (a separate "<name>_test" database, see
// tests/integration/testDatabase.ts) and the real Payload config. Run with `pnpm test:integration`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    globalSetup: ['tests/integration/globalSetup.ts'],
    setupFiles: ['tests/integration/env.ts'],
    // One database, so the files run one after another.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
})
