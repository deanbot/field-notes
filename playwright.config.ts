// End-to-end tests of the examples, in Chromium, Firefox and WebKit. Run
// `pnpm e2e`, which builds the package and the examples first.
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { PORTS } from './tests/e2e/helpers.ts';

const vite = join(import.meta.dirname, 'node_modules/vite/bin/vite.js');
const viteVue = join(import.meta.dirname, 'examples/vite-vue');

export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: [
    {
      // Local mode: the dev server, with the Vite plugin taking notes.
      command: `node ${vite} --port ${String(PORTS.viteVueDev)} --strictPort`,
      cwd: viteVue,
      url: `http://localhost:${String(PORTS.viteVueDev)}/`,
      reuseExistingServer: false,
    },
    {
      // Export mode: the production build made with `--mode export`.
      command: `node ${vite} preview --outDir dist/export --port ${String(PORTS.viteVueExport)} --strictPort`,
      cwd: viteVue,
      url: `http://localhost:${String(PORTS.viteVueExport)}/`,
      reuseExistingServer: false,
    },
  ],
});
