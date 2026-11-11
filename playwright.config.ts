import 'dotenv/config'
import { defineConfig, devices } from '@playwright/test'

// End-to-end checks of the admin in a real browser. They only read and click: no test saves
// a form or applies a bulk change, so they can run against seeded dev data.
// Run with `pnpm test:e2e`. It starts `pnpm dev` unless a server already answers.
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000'

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev',
    url: `${baseURL}/healthz`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
})
