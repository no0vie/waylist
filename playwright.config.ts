import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', timeout: 60_000, fullyParallel: false, workers: 1,
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    { command: 'node --import tsx server/index.ts', url: 'http://localhost:3001/api/auth/me', env: { NODE_ENV: 'test', PORT: '3001', APP_URL: 'http://localhost:4173', DATABASE_PATH: 'data/e2e.sqlite', SMTP_HOST: '', SMTP_FROM: '' }, reuseExistingServer: false, timeout: 30000 },
    { command: 'npx vite preview --host localhost --port 4173 --strictPort', url: 'http://localhost:4173', reuseExistingServer: false, timeout: 30000 },
  ],
});
