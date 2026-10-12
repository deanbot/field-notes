/// <reference lib="dom" />
// Checks the built browser output of `field-notes` (run after `pnpm build`):
// what each file may contain, that a consumer's production build drops the
// widget, and that the script-tag and npm builds share a page in a browser.
// (The DOM types are for the callbacks that run in that page.)
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { build, type Rolldown } from 'vite';

const dist = resolve(import.meta.dirname, '../packages/field-notes/dist');
const read = (file: string): string => readFileSync(join(dist, file), 'utf8');
const files = readdirSync(dist);

const LIT = 'litHtmlVersions';
const ZOD = '_zod';
const YAML = /YAMLParseError|yaml-1\.1/;
const FFLATE = 'invalid zip data';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}\n${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

const stub = read('index.js');
const panelFile = files.find((file) => /^panel-.*\.js$/.test(file));
const iife = read('widget.iife.js');

console.log('check-dist');

await check('the activation stub has no Lit, Zod, yaml or fflate', () => {
  assert(!stub.includes(LIT), 'Lit is in the stub');
  assert(!stub.includes(ZOD), 'Zod is in the stub');
  assert(!YAML.test(stub) && !stub.includes(FFLATE), 'yaml or fflate is in the stub');
});

await check('the stub imports no chunk statically, so its size is its own', () => {
  const statics = stub.match(/^import\b.*$/gm) ?? [];
  assert(statics.length === 0, `static imports: ${statics.join('; ')}`);
});

await check('the stub leaves process.env.NODE_ENV for the consumer to resolve', () => {
  assert(stub.includes('process.env.NODE_ENV'), 'NODE_ENV was resolved at build time');
});

await check('the panel is a lazy chunk with Lit and without yaml or fflate', () => {
  assert(panelFile, 'no panel chunk');
  assert(stub.includes(`import("./${panelFile}")`), 'the stub does not lazy-load the panel');
  const panel = read(panelFile);
  assert(panel.includes(LIT), 'Lit is not in the panel');
  assert(!YAML.test(panel) && !panel.includes(FFLATE), 'yaml or fflate is in the panel');
});

await check('the script-tag build is one classic script', () => {
  assert(!/\bimport\s*\(|\bimport\.meta\b|^import\b/m.test(iife), 'it imports');
  assert(!iife.includes('process.env'), 'it reads process.env');
  assert(iife.startsWith('var FieldNotes='), 'it does not define window.FieldNotes');
});

/** Minified chunks of a Vite production build of `source`, importing the built package. */
async function consumerBuild(source: string): Promise<Rolldown.OutputChunk[]> {
  const output = (await build({
    configFile: false,
    logLevel: 'silent',
    mode: 'production',
    resolve: { alias: { 'field-notes': join(dist, 'index.js') } },
    plugins: [
      {
        name: 'entry',
        resolveId: (id) => (id === 'entry' ? id : undefined),
        load: (id) => (id === 'entry' ? source : undefined),
      },
    ],
    build: { write: false, minify: true, rolldownOptions: { input: 'entry' } },
  })) as Rolldown.RolldownOutput[] | Rolldown.RolldownOutput;
  const [result] = Array.isArray(output) ? output : [output];
  return result?.output.filter((item) => item.type === 'chunk') ?? [];
}

await check("a consumer's production build drops a DEV-guarded widget", async () => {
  const chunks = await consumerBuild(
    `import { mountFieldNotes } from 'field-notes';\nif (import.meta.env.DEV) mountFieldNotes();\nconsole.log('app');`,
  );
  const code = chunks.map((chunk) => chunk.code).join('');
  assert(chunks.length === 1, `expected one chunk, got ${String(chunks.length)}`);
  assert(code.includes('app'), 'the app code is missing');
  assert(!code.includes('field-notes'), 'widget code is in the production build');
});

await check("a consumer's production build resolves enabled: 'auto' to off", async () => {
  const chunks = await consumerBuild(
    `import { mountFieldNotes } from 'field-notes';\nmountFieldNotes();`,
  );
  const code = chunks.map((chunk) => chunk.code).join('');
  assert(code.includes('field-notes'), 'the widget is missing');
  assert(!code.includes('process.env'), 'NODE_ENV was left for the browser to look up');
});

await check('script tag and npm import on one page share a single widget', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const origin = 'http://field-notes.test';
    const requested: string[] = [];
    await page.route(`${origin}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      requested.push(path);
      if (path === '/') {
        await route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><html><head><script src="/widget.iife.js"></script></head><body>
            <script type="module">
              import { mountFieldNotes } from '/index.js';
              window.esm = mountFieldNotes();
            </script></body></html>`,
        });
        return;
      }
      await route.fulfill({ contentType: 'text/javascript', body: read(path.slice(1)) });
    });
    const warnings: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'warning') warnings.push(message.text());
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(`${origin}/`);
    await page.waitForFunction(() => 'esm' in window);
    const state = await page.evaluate(() => {
      const els = document.querySelectorAll('field-notes');
      const handle = (els[0] as unknown as Record<symbol, unknown> | undefined)?.[
        Symbol.for('field-notes.handle')
      ];
      return { count: els.length, shared: handle === (window as { esm?: unknown }).esm };
    });
    assert(errors.length === 0, `page errors: ${errors.join('; ')}`);
    assert(state.count === 1, `expected one <field-notes>, got ${String(state.count)}`);
    assert(state.shared, 'the npm import did not reuse the script-tag mount');
    assert(
      warnings.some((text) => text.includes('already mounted')),
      'no double-mount warning',
    );
    assert(
      !requested.some((path) => path.startsWith('/panel-')),
      'the panel chunk loaded before open',
    );

    await page.evaluate(() => (window as { esm?: { open(): Promise<void> } }).esm?.open());
    const dialogs = await page.evaluate(
      () =>
        document.querySelector('field-notes')?.shadowRoot?.querySelectorAll('[role="dialog"]')
          .length,
    );
    assert(dialogs === 1, `expected one open panel, got ${String(dialogs)}`);
  } finally {
    await browser.close();
  }
});

if (process.exitCode) console.error('check-dist: FAILED');
else console.log('check-dist: ok');
