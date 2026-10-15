import { playwright } from '@vitest/browser-playwright';
import { type TestProjectInlineConfiguration, defineConfig } from 'vitest/config';
import { consoleCommands } from './scripts/vitest-console.ts';
import { sinkCommands } from './scripts/vitest-sink.ts';

type BrowserName = 'chromium' | 'firefox' | 'webkit';

// Chromium by default (and required for v8 coverage). CI also runs the
// browser project against each engine, one job per engine, via BROWSERS.
const browsers = (process.env.BROWSERS ?? 'chromium').split(',') as BrowserName[];

const strict = { lines: 90, branches: 90, functions: 90, statements: 90 };
const widget = { lines: 80, branches: 80, functions: 80, statements: 80 };

/** Specially named files run only in their own project, on their own page. */
const SPECIAL = ['**/*.quirks.test.ts', '**/*.csp.test.ts'];

/** Browser tests, on a tester page from packages/widget/test/ when `page` is given. */
function browserProject(
  name: string,
  include: string[],
  page?: string,
): TestProjectInlineConfiguration {
  return {
    test: {
      name,
      // One file at a time: files share an origin, so localStorage and
      // IndexedDB (the outbox) would leak between files run in parallel.
      fileParallelism: false,
      include,
      exclude: name === 'browser' ? SPECIAL : [],
      browser: {
        enabled: true,
        headless: true,
        provider: playwright(),
        ...(page ? { testerHtmlPath: `packages/widget/test/${page}` } : {}),
        // A real sink, run in Node, for the local transport's tests, and the
        // browser's own console warnings.
        commands: { ...sinkCommands, ...consoleCommands },
        instances: browsers.map((browser) => ({ browser })),
      },
    },
  };
}

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['packages/{core,sink,cli}/src/**/*.test.ts', 'scripts/**/*.test.ts'],
          exclude: ['**/*.browser.test.ts'],
        },
      },
      browserProject('browser', [
        'packages/widget/src/**/*.test.ts',
        // core is isomorphic: its *.browser.test.ts files prove it runs without Node.
        'packages/core/src/**/*.browser.test.ts',
      ]),
      // Pages unlike the usual tester page: one without a doctype, and one
      // whose Content Security Policy blocks data: images.
      browserProject('browser-quirks', ['packages/widget/src/**/*.quirks.test.ts'], 'quirks.html'),
      browserProject('browser-csp', ['packages/widget/src/**/*.csp.test.ts'], 'csp.html'),
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
