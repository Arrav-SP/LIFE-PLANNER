import { defineConfig, devices } from '@playwright/test'

// End-to-end tests run against a production build in local mode (no Supabase
// keys), so they need no account or network.
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4174',
    timezoneId: 'Asia/Kolkata',
    trace: 'retain-on-failure',
    serviceWorkers: 'block',
  },
  webServer: {
    command: 'npx vite build --mode e2e && npx vite preview --port 4174 --strictPort',
    url: 'http://localhost:4174',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
})
