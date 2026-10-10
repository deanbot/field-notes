import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

type BrowserName = 'chromium' | 'firefox' | 'webkit';

// Chromium by default (and required for v8 coverage). CI also runs the
// browser project against every engine via BROWSERS=chromium,firefox,webkit.
const browsers = (process.env.BROWSERS ?? 'chromium').split(',') as BrowserName[];

const strict = { lines: 90, branches: 90, functions: 90, statements: 90 };
const widget = { lines: 80, branches: 80, functions: 80, statements: 80 };

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['packages/{core,sink,cli}/src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'browser',
          include: ['packages/widget/src/**/*.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: browsers.map((browser) => ({ browser })),
          },
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/{core,widget,sink,cli}/src/**/*.ts'],
      exclude: ['**/*.test.ts'],
      thresholds: {
        'packages/{core,sink,cli}/src/**': strict,
        'packages/widget/src/**': widget,
      },
    },
  },
});
