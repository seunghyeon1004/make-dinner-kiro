import { createServer } from 'node:net';
import { defineConfig } from '@playwright/test';

/** Asks the OS for a free port. Workers re-read this file, so the choice is shared via the env. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

const port = process.env['E2E_PORT'] ? Number(process.env['E2E_PORT']) : await freePort();
process.env['E2E_PORT'] = String(port);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.spec.ts',
  outputDir: 'test-results',
  forbidOnly: true,
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL },
  projects: [
    {
      name: 'phone',
      use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, hasTouch: true },
    },
    {
      name: 'desktop',
      use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    // The key is unset, not empty: e2e must run with samples and import only.
    command: 'unset ANTHROPIC_API_KEY; npm run build && npm start',
    url: `${baseURL}/api/health`,
    env: { PORT: String(port) },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
