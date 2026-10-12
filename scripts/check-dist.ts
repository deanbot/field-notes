/// <reference lib="dom" />
// Checks the built browser output of `field-notes` (run after `pnpm build`):
// what each file may contain, that a consumer's production build drops the
// widget, and that the script-tag and npm builds share a page in a browser.
// (The DOM types are for the callbacks that run in that page.)
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
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
const syncFile = files.find((file) => /^sync-.*\.js$/.test(file));

/** A chunk and every chunk it imports statically, as one text. */
function withImports(file: string, seen = new Set<string>()): string {
  if (seen.has(file)) return '';
  seen.add(file);
  const code = read(file);
  const imports = [...code.matchAll(/\bfrom\s*["'`]\.\/([^"'`]+)|\bimport\s*["'`]\.\/([^"'`]+)/g)];
  return code + imports.map((m) => withImports(m[1] ?? m[2] ?? '', seen)).join('');
}

/** Whether the stub loads `file` with a dynamic import. */
const lazyFromStub = (file: string): boolean =>
  ['"', "'", '`'].some((q) => stub.includes(`import(${q}./${file}${q})`));
const iife = read('widget.iife.js');

console.log('check-dist');

await check('the activation stub has no Lit, Zod, yaml or fflate', () => {
  assert(!stub.includes(LIT), 'Lit is in the stub');
  assert(!stub.includes(ZOD), 'Zod is in the stub');
  assert(!YAML.test(stub) && !stub.includes(FFLATE), 'yaml or fflate is in the stub');
});

await check('the stub never touches IndexedDB (the outbox is in the panel chunk)', () => {
  assert(!stub.includes('indexedDB'), 'the stub references indexedDB');
});

await check('the stub imports no chunk statically, so its size is its own', () => {
  // `from "./x.js"` or a bare `import "./x.js"`, in any quotes, minified or not.
  const statics = stub.match(/\bfrom\s*["'`]\.\/[^"'`]+|\bimport\s*["'`]\.\/[^"'`]+/g) ?? [];
  assert(statics.length === 0, `static imports: ${statics.join('; ')}`);
});

await check('the stub leaves process.env.NODE_ENV for the consumer to resolve', () => {
  assert(stub.includes('process.env.NODE_ENV'), 'NODE_ENV was resolved at build time');
});

await check('the panel is a lazy chunk with Lit and Zod, without yaml or fflate', () => {
  assert(panelFile, 'no panel chunk');
  assert(lazyFromStub(panelFile), 'the stub does not lazy-load the panel');
  // With the chunks it imports: the outbox (and Zod with it) is shared with delivery.
  const panel = withImports(panelFile);
  assert(panel.includes(LIT), 'Lit is not in the panel');
  assert(panel.includes(ZOD), 'zod/mini is not in the panel (note validation)');
  assert(!YAML.test(panel) && !panel.includes(FFLATE), 'yaml or fflate is in the panel');
});

await check('delivery is a lazy chunk without Lit, yaml or fflate', () => {
  assert(syncFile, 'no sync chunk');
  assert(lazyFromStub(syncFile), 'the stub does not lazy-load delivery');
  const sync = withImports(syncFile);
  assert(!sync.includes(LIT), 'Lit is in the delivery chunks');
  assert(!YAML.test(sync) && !sync.includes(FFLATE), 'yaml or fflate is in the delivery chunks');
});

await check('the script-tag build has one token placeholder for `serve` to fill', () => {
  const found = iife.split('{{field-notes-token}}').length - 1;
  assert(found === 1, `expected one placeholder, found ${String(found)}`);
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
    // The module script runs before DOMContentLoaded, when the script tag
    // mounts, so here the script tag is the one that reuses.
    assert(state.shared, 'the script tag did not reuse the npm mount');
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
      () => document.querySelector('field-notes')?.shadowRoot?.querySelectorAll('dialog').length,
    );
    assert(dialogs === 1, `expected one open panel, got ${String(dialogs)}`);

    const survives = await page.evaluate(() => {
      const w = window as { esm?: { active: boolean }; FieldNotes?: { unmount(): void } };
      w.FieldNotes?.unmount();
      return w.esm?.active;
    });
    assert(survives === true, "window.FieldNotes.unmount() tore down the page's own mount");
  } finally {
    await browser.close();
  }
});

await check('a script tag from the built `serve` captures a note to disk', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'field-notes-check-dist-'));
  const serve = spawn(
    process.execPath,
    [join(dist, 'cli.js'), 'serve', '--port', '0', '--dir', join(dir, '.field-notes')],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const browser = await chromium.launch();
  const cleanups: (() => void)[] = [];
  try {
    const url = await new Promise<string>((done, fail) => {
      let out = '';
      serve.stdout.on('data', (chunk: Buffer) => {
        out += chunk.toString();
        const found = /http:\/\/127\.0\.0\.1:\d+/.exec(out);
        if (found) done(found[0]);
      });
      serve.once('exit', (code) => {
        fail(new Error(`serve exited (${String(code)}): ${out}`));
      });
    });
    // The app's page, from a real loopback server (as a dev server is: Chrome
    // only lets loopback pages reach loopback), on an origin the sink allows.
    const appServer = createServer((_, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        `<!doctype html><html><head><script src="${url}/widget.js"></script></head><body></body></html>`,
      );
    });
    cleanups.push(() => appServer.close());
    await new Promise<void>((done) => appServer.listen(0, '127.0.0.1', done));
    const app = `http://localhost:${String((appServer.address() as AddressInfo).port)}`;
    const page = await browser.newPage();
    const problems: string[] = [];
    page.on('console', (message) => problems.push(`${message.type()}: ${message.text()}`));
    page.on('pageerror', (error) => problems.push(error.message));
    page.on('requestfailed', (request) =>
      problems.push(`${request.url()} ${request.failure()?.errorText ?? ''}`),
    );
    await page.goto(`${app}/`);
    await page
      .waitForFunction(() => document.querySelector('field-notes'), undefined, { timeout: 5000 })
      .catch((error: unknown) => {
        throw new Error(`${String(error)}\n${problems.join('\n')}`);
      });
    await page.evaluate(() =>
      (window as { FieldNotes?: { open(): Promise<void> } }).FieldNotes?.open(),
    );
    await page.locator('field-notes textarea').fill('From the built script tag');
    await page.keyboard.press('Control+Enter');
    const items = join(dir, '.field-notes', 'items');
    let stored: string[] = [];
    for (let i = 0; i < 100 && stored.length === 0; i++) {
      await new Promise((done) => setTimeout(done, 100));
      stored = readdirSync(items);
    }
    assert(stored.length === 1, `expected one note on disk, found ${String(stored.length)}`);
    const note = readFileSync(join(items, stored[0] ?? '', 'note.md'), 'utf8');
    assert(note.includes('From the built script tag'), 'the note on disk is not the one sent');
  } finally {
    await browser.close();
    for (const cleanup of cleanups) cleanup();
    serve.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

if (process.exitCode) console.error('check-dist: FAILED');
else console.log('check-dist: ok');
