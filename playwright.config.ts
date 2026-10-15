// End-to-end tests of the examples, in Chromium, Firefox and WebKit. Run
// `pnpm e2e`, which builds the package and the examples first.
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { PORTS } from './tests/e2e/helpers.ts';

const vite = join(import.meta.dirname, 'node_modules/vite/bin/vite.js');
const viteVue = join(import.meta.dirname, 'examples/vite-vue');
const cli = join(import.meta.dirname, 'packages/field-notes/dist/cli.js');
const scriptTagNotes = join(import.meta.dirname, 'tests/e2e/fixtures/script-tag/.field-notes');

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
    {
      // Next.js on its custom server, with the middleware taking notes.
      command: 'node server.ts',
      cwd: join(import.meta.dirname, 'examples/next'),
      env: { PORT: String(PORTS.next), NEXT_TELEMETRY_DISABLED: '1' },
      url: `http://localhost:${String(PORTS.next)}/`,
      reuseExistingServer: false,
      // A cold first compile can take a while on CI.
      timeout: 180_000,
    },
    {
      // The script-tag path: the built `serve`, and a static page using it.
      command: `node ${cli} serve --port ${String(PORTS.scriptTagSink)} --dir ${scriptTagNotes}`,
      url: `http://127.0.0.1:${String(PORTS.scriptTagSink)}/health`,
      reuseExistingServer: false,
    },
    {
      command: 'node tests/e2e/static-server.ts',
      url: `http://localhost:${String(PORTS.scriptTagPage)}/`,
      reuseExistingServer: false,
    },
  ],
});
