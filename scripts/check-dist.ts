/// <reference lib="dom" />
// Checks the built browser output of `field-notes` (run after `pnpm build`):
// what each file may contain, that a consumer's production build drops the
// widget, and that the script-tag and npm builds share a page in a browser.
// (The DOM types are for the callbacks that run in that page.)
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { build, createServer as createViteServer, type Rolldown } from 'vite';
import { readBundle } from '../packages/core/src/index.ts';
import type * as VitePluginModule from '../packages/field-notes/src/vite.ts';

const dist = resolve(import.meta.dirname, '../packages/field-notes/dist');
const read = (file: string): string => readFileSync(join(dist, file), 'utf8');
const files = readdirSync(dist);

const LIT = 'litHtmlVersions';
const ZOD = '_zod';
const YAML = /YAMLParseError|yaml-1\.1/;
const FFLATE = 'invalid zip data';
const FINDER = 'Selector was not found';
const SCREENSHOT = '______background-clip--text';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/**
 * The note directories in `items` that are finished: the sink writes
 * `note.md` last, so a directory without it is still being written.
 */
const finishedNotes = (items: string): string[] =>
  existsSync(items)
    ? readdirSync(items).filter((dir) => existsSync(join(items, dir, 'note.md')))
    : [];

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
const exportFile = files.find((file) => /^export-.*\.js$/.test(file));
const pickerFile = files.find((file) => /^picker-.*\.js$/.test(file));
const screenshotFile = files.find((file) => /^screenshot-.*\.js$/.test(file));
const displayFile = files.find((file) => /^display-.*\.js$/.test(file));
// Region Capture's method: only the display capture uses it.
const DISPLAY = 'cropTo';

/** A chunk and every chunk it imports statically, as one text. */
function withImports(file: string, seen = new Set<string>()): string {
  if (seen.has(file)) return '';
  seen.add(file);
  const code = read(file);
  const imports = [...code.matchAll(/\bfrom\s*["'`]\.\/([^"'`]+)|\bimport\s*["'`]\.\/([^"'`]+)/g)];
  return code + imports.map((m) => withImports(m[1] ?? m[2] ?? '', seen)).join('');
}

/** Whether `code` loads `file` with a dynamic import. */
const lazyFrom = (code: string, file: string): boolean =>
  ['"', "'", '`'].some((q) => code.includes(`import(${q}./${file}${q})`));
const lazyFromStub = (file: string): boolean => lazyFrom(stub, file);
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

await check('export is a lazy chunk with fflate and yaml, without Lit', () => {
  assert(exportFile, 'no export chunk');
  assert(lazyFromStub(exportFile), 'the stub does not lazy-load export');
  const chunk = withImports(exportFile);
  assert(chunk.includes(FFLATE) && YAML.test(chunk), 'fflate or yaml is not in the export chunks');
  assert(!chunk.includes(LIT), 'Lit is in the export chunks');
});

await check(
  'the element picker is a lazy chunk of the panel, with finder and nothing else big',
  () => {
    assert(pickerFile && panelFile, 'no picker or panel chunk');
    assert(lazyFrom(read(panelFile), pickerFile), 'the panel does not lazy-load the picker');
    assert(!withImports(panelFile).includes(FINDER), 'finder is in the panel chunks');
    const picker = withImports(pickerFile);
    assert(picker.includes(FINDER), 'finder is not in the picker chunk');
    for (const [name, found] of [
      ['Lit', picker.includes(LIT)],
      ['Zod', picker.includes(ZOD)],
      ['yaml or fflate', YAML.test(picker) || picker.includes(FFLATE)],
    ] as const) {
      assert(!found, `${name} is in the picker chunks`);
    }
  },
);

await check(
  'the screenshot is a lazy chunk of the stub (loaded with the panel), with modern-screenshot and nothing else big',
  () => {
    assert(screenshotFile && panelFile, 'no screenshot or panel chunk');
    assert(lazyFromStub(screenshotFile), 'the stub does not lazy-load the screenshot');
    assert(!stub.includes(SCREENSHOT), 'modern-screenshot is in the stub');
    assert(
      !withImports(panelFile).includes(SCREENSHOT),
      'modern-screenshot is in the panel chunks',
    );
    const chunk = withImports(screenshotFile);
    assert(chunk.includes(SCREENSHOT), 'modern-screenshot is not in the screenshot chunk');
    for (const [name, found] of [
      ['Lit', chunk.includes(LIT)],
      ['Zod', chunk.includes(ZOD)],
      ['yaml or fflate', YAML.test(chunk) || chunk.includes(FFLATE)],
    ] as const) {
      assert(!found, `${name} is in the screenshot chunks`);
    }
  },
);

await check(
  'the display capture is a lazy chunk of the stub, without modern-screenshot or anything else big',
  () => {
    assert(displayFile, 'no display chunk');
    assert(lazyFromStub(displayFile), 'the stub does not lazy-load the display capture');
    assert(!stub.includes(DISPLAY), 'the display capture is in the stub');
    const chunk = withImports(displayFile);
    assert(chunk.includes(DISPLAY), 'the display capture is not in its chunk');
    for (const [name, found] of [
      ['modern-screenshot', chunk.includes(SCREENSHOT)],
      ['Lit', chunk.includes(LIT)],
      ['Zod', chunk.includes(ZOD)],
      ['yaml or fflate', YAML.test(chunk) || chunk.includes(FFLATE)],
    ] as const) {
      assert(!found, `${name} is in the display chunks`);
    }
  },
);

await check('the script-tag build has the screenshot inlined (local mode takes them too)', () => {
  assert(iife.includes(SCREENSHOT), 'modern-screenshot is not in the script-tag build');
  assert(iife.includes(DISPLAY), 'the display capture is not in the script-tag build');
});

await check('the script-tag build has the element picker inlined (local mode picks too)', () => {
  assert(iife.includes(FINDER), 'finder is not in the script-tag build');
});

await check(
  'the script-tag build has no export chunk inlined (only `serve`, local mode, serves it)',
  () => {
    assert(!YAML.test(iife) && !iife.includes(FFLATE), 'yaml or fflate is in the script-tag build');
  },
);

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

await check(
  "a consumer's production build with enabled: 'query' ships only the stub until ?field-notes=1",
  async () => {
    const chunks = await consumerBuild(
      `import { mountFieldNotes } from 'field-notes';\nmountFieldNotes({ enabled: 'query' });`,
    );
    const entry = chunks.find((chunk) => chunk.isEntry);
    assert(entry, 'no entry chunk');
    assert(entry.code.includes('field-notes:enabled'), "the 'query' check is missing");
    assert(!entry.code.includes(LIT) && !entry.code.includes(ZOD), 'Lit or Zod is in the entry');
    assert(
      chunks.some((chunk) => chunk.code.includes(LIT)),
      'the panel was not split into a chunk',
    );

    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const origin = 'http://field-notes.test';
      const requested: string[] = [];
      await page.route(`${origin}/**`, async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/') {
          await route.fulfill({
            contentType: 'text/html',
            body: `<!doctype html><script type="module" src="/${entry.fileName}"></script>`,
          });
          return;
        }
        requested.push(path);
        const chunk = chunks.find((c) => `/${c.fileName}` === path);
        await route.fulfill(
          chunk ? { contentType: 'text/javascript', body: chunk.code } : { status: 404 },
        );
      });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      /** Opens the page, and says whether the widget mounted. */
      const mounted = async (search: string): Promise<boolean> => {
        await page.goto(`${origin}/${search}`);
        await page.waitForLoadState('load');
        return page.evaluate(() => document.querySelector('field-notes') !== null);
      };

      assert(!(await mounted('')), 'the widget mounted without ?field-notes=1');
      assert(
        requested.length === 1 && requested[0] === `/${entry.fileName}`,
        `more than the stub loaded: ${requested.join(', ')}`,
      );
      assert(await mounted('?field-notes=1'), 'the widget did not mount with ?field-notes=1');
      assert(await mounted(''), 'the widget did not stay on after ?field-notes=1');
      assert(!(await mounted('?field-notes=0')), 'the widget stayed on after ?field-notes=0');
      assert(!(await mounted('')), 'the widget came back after ?field-notes=0');
      assert(errors.length === 0, `page errors: ${errors.join('; ')}`);
    } finally {
      await browser.close();
    }
  },
);

await check(
  "a consumer's production build in export mode downloads a zip of the notes, sending nothing, and `field-notes import` takes it once",
  async () => {
    const chunks = await consumerBuild(
      `import { mountFieldNotes } from 'field-notes';\nwindow.fieldNotes = mountFieldNotes({ enabled: true, mode: 'export' });`,
    );
    const entry = chunks.find((chunk) => chunk.isEntry);
    assert(entry, 'no entry chunk');
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ acceptDownloads: true });
      const origin = 'http://field-notes.test';
      const requested: string[] = [];
      await page.route(`${origin}/**`, async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/') {
          await route.fulfill({
            contentType: 'text/html',
            body: `<!doctype html><body><script type="module" src="/${entry.fileName}"></script></body>`,
          });
          return;
        }
        requested.push(path);
        const chunk = chunks.find((c) => `/${c.fileName}` === path);
        await route.fulfill(
          chunk ? { contentType: 'text/javascript', body: chunk.code } : { status: 404 },
        );
      });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${origin}/`);
      await page.waitForFunction(() => 'fieldNotes' in window);
      const screenshotChunk = (): boolean =>
        requested.some((path) => /\/screenshot-[^/]*\.js$/.test(path));
      assert(!screenshotChunk(), 'the screenshot chunk loaded before the widget opened');

      const open = (): Promise<void> =>
        page.evaluate(() =>
          (window as { fieldNotes?: { open(): Promise<void> } }).fieldNotes?.open(),
        );
      await open();
      assert(screenshotChunk(), 'opening the widget did not load the screenshot chunk');
      assert(
        !requested.some((path) => /\/display-[^/]*\.js$/.test(path)),
        'the display chunk loaded for a DOM screenshot',
      );
      await page.locator('.shot img[src^="blob:"]').waitFor();
      await page.locator('#field-notes-text').fill('Exported from a production build');
      await page.keyboard.press('Control+Enter');
      await page.locator('dialog').waitFor({ state: 'detached' });
      await open();
      await page.getByRole('button', { name: /^My notes/ }).click();
      const exportButton = page.getByRole('button', { name: 'Export (1)' });
      await exportButton.waitFor();
      assert(
        !requested.some((path) => /\/export-[^/]*\.js$/.test(path)),
        'the export chunk loaded before Export was clicked',
      );

      const [download] = await Promise.all([page.waitForEvent('download'), exportButton.click()]);
      const name = download.suggestedFilename();
      assert(/^field-notes-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/.test(name), `file name: ${name}`);
      const zip = new Uint8Array(readFileSync(await download.path()));
      const read = readBundle(zip);
      assert(read.ok, `the zip is not a bundle: ${read.ok ? '' : read.error.message}`);
      assert(
        read.value.length === 1 && read.value[0]?.note.body === 'Exported from a production build',
        'the zip does not hold the note',
      );
      const item = read.value.at(0);
      assert(
        item?.note.screenshot === 'screenshot.png' && 'screenshot.png' in item.attachments,
        'the zip has no screenshot for the note',
      );
      assert(new TextDecoder().decode(zip).includes('index.md'), 'the zip has no index.md');

      // The built `field-notes import` takes it into a project, once.
      const project = mkdtempSync(join(tmpdir(), 'field-notes-check-import-'));
      try {
        const zipFile = join(project, name);
        writeFileSync(zipFile, zip);
        const importIt = (): ReturnType<typeof spawnSync> =>
          spawnSync(process.execPath, [join(dist, 'cli.js'), 'import', zipFile], {
            cwd: project,
            encoding: 'utf8',
          });
        const first = importIt();
        assert(first.status === 0, `import failed: ${String(first.stderr)}`);
        const items = join(project, '.field-notes', 'items');
        const [dir] = finishedNotes(items);
        assert(dir, 'import wrote no note');
        assert(
          readFileSync(join(items, dir, 'note.md'), 'utf8').includes(
            'Exported from a production build',
          ),
          'the imported note is not the exported one',
        );
        assert(existsSync(join(items, dir, 'screenshot.png')), 'import wrote no screenshot');
        const again = importIt();
        assert(
          again.status === 0 && String(again.stdout).includes('1 note already there'),
          `importing again was not a no-op: ${String(again.stdout)}${String(again.stderr)}`,
        );
        assert(finishedNotes(items).length === 1, 'importing again added notes');
      } finally {
        rmSync(project, { recursive: true, force: true });
      }
      assert(
        requested.some((path) => /\/export-[^/]*\.js$/.test(path)),
        'no export chunk was loaded',
      );
      assert(
        requested.every((path) => path.endsWith('.js')),
        `requests other than chunks: ${requested.filter((path) => !path.endsWith('.js')).join(', ')}`,
      );
      assert(errors.length === 0, `page errors: ${errors.join('; ')}`);
    } finally {
      await browser.close();
    }
  },
);

// A real share of the tab. CI only: elsewhere the browser may ask the OS for
// screen recording, and the share must never reach for a real screen.
const DISPLAY_E2E =
  "a consumer's production build in display mode shares this tab, masked and without the widget, on a tall page and a short one";
if (process.env.CI) {
  await check(DISPLAY_E2E, async () => {
    const chunks = await consumerBuild(
      `import { mountFieldNotes } from 'field-notes';\nwindow.fieldNotes = mountFieldNotes({ enabled: true, mode: 'export', screenshot: 'display' });`,
    );
    const entry = chunks.find((chunk) => chunk.isEntry);
    assert(entry, 'no entry chunk');
    // Full Chromium: the headless shell can't share a tab. The flag accepts
    // the browser's "share this tab" prompt, and nothing else.
    const browser = await chromium.launch({
      channel: 'chromium',
      args: ['--auto-accept-this-tab-capture'],
    });
    // The widget is themed red like the masked field, so neither may show.
    const red = 'rgb(255,0,0)';
    const pages = {
      'a tall page, scrolled, with a fixed field': `<body style="margin:0;height:3000px;background:rgb(0,0,255)"><input type="password" value="secret" style="position:fixed;top:40px;left:40px;width:120px;height:30px;border:0;background:${red};color:${red}">`,
      'a page shorter than the window, with the field near the top': `<body style="margin:0;background:rgb(0,0,255)"><input type="password" value="secret" style="display:block;margin:20px;width:120px;height:30px;border:0;background:${red};color:${red}">`,
    };
    try {
      for (const [name, body] of Object.entries(pages)) {
        const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
        // A secure origin: there's no screen sharing without one.
        const origin = 'https://field-notes.test';
        const requested: string[] = [];
        await page.route(`${origin}/**`, async (route) => {
          const path = new URL(route.request().url()).pathname;
          if (path === '/') {
            await route.fulfill({
              contentType: 'text/html',
              body: `<!doctype html><style>field-notes { --field-notes-bg: ${red}; --field-notes-button-bg: ${red}; --field-notes-button-fg: ${red}; }</style>${body}<script type="module" src="/${entry.fileName}"></script>`,
            });
            return;
          }
          requested.push(path);
          const chunk = chunks.find((c) => `/${c.fileName}` === path);
          await route.fulfill(
            chunk ? { contentType: 'text/javascript', body: chunk.code } : { status: 404 },
          );
        });
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(`${origin}/`);
        await page.waitForFunction(() => 'fieldNotes' in window);
        await page.evaluate(() => {
          scrollTo(0, 500);
        });
        // A click: sharing needs a user gesture.
        await page.locator('field-notes .trigger').click();
        await page.locator('.shot img[src^="blob:"]').waitFor();
        assert(
          requested.some((path) => /\/display-[^/]*\.js$/.test(path)),
          `${name}: the display chunk did not load`,
        );
        assert(
          !requested.some((path) => /\/screenshot-[^/]*\.js$/.test(path)),
          `${name}: the DOM screenshot was taken instead of the share`,
        );
        const shot = await page.evaluate(async () => {
          const img = document.querySelector('field-notes')?.shadowRoot?.querySelector('.shot img');
          if (!(img instanceof HTMLImageElement)) throw new Error('no thumbnail');
          const bitmap = await createImageBitmap(await (await fetch(img.src)).blob());
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const paint = canvas.getContext('2d');
          if (!paint) throw new Error('no 2d context');
          paint.drawImage(bitmap, 0, 0);
          const { data } = paint.getImageData(0, 0, canvas.width, canvas.height);
          const scale = Math.min(devicePixelRatio, 2);
          const at = (x: number, y: number): number[] => {
            const i = (Math.floor(y * scale) * canvas.width + Math.floor(x * scale)) * 4;
            return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
          };
          let reds = 0;
          for (let i = 0; i < data.length; i += 4) {
            if ((data[i] ?? 0) > 150 && (data[i + 1] ?? 0) < 100 && (data[i + 2] ?? 0) < 100) {
              reds++;
            }
          }
          const field = document.querySelector('input')?.getBoundingClientRect();
          if (!field) throw new Error('no field');
          const { clientWidth, clientHeight } = document.documentElement;
          return {
            reds,
            field: at(field.x + field.width / 2, field.y + field.height / 2),
            // Below the field and the widget: the page itself.
            page: at(clientWidth / 2, clientHeight - 100),
          };
        });
        const blue = ([r = 0, g = 0, b = 0]: number[]): boolean => r < 60 && g < 60 && b > 200;
        assert(blue(shot.page), `${name}: the page isn't in the shot: ${shot.page.join(',')}`);
        assert(
          shot.reds === 0,
          `${name}: ${String(shot.reds)} red pixels, of the masked field or the widget`,
        );
        assert(
          shot.field.every((value) => Math.abs(value - 136) < 10),
          `${name}: the masked field isn't painted over where it is: ${shot.field.join(',')}`,
        );
        assert(errors.length === 0, `${name}: page errors: ${errors.join('; ')}`);
        await page.close();
      }
    } finally {
      await browser.close();
    }
  });
} else {
  console.log(`  - ${DISPLAY_E2E} (CI only)`);
}

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
      stored = finishedNotes(items);
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

await check(
  'the built Vite plugin takes a note from the built widget, with no options',
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'field-notes-check-vite-'));
    // The page imports what `field-notes` ships; no token, no endpoint.
    writeFileSync(
      join(root, 'index.html'),
      `<!doctype html><html><body><script type="module">
      import { mountFieldNotes } from '/@fs${join(dist, 'index.js')}';
      window.handle = mountFieldNotes({ enabled: true });
    </script></body></html>`,
    );
    const { fieldNotes } = (await import(join(dist, 'vite.js'))) as typeof VitePluginModule;
    const server = await createViteServer({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [fieldNotes()],
      server: { port: 0, host: '127.0.0.1', fs: { allow: [root, dist] } },
    });
    const browser = await chromium.launch();
    try {
      await server.listen();
      const { port } = server.httpServer?.address() as AddressInfo;
      const page = await browser.newPage();
      const seen: string[] = [];
      page.on('console', (message) => seen.push(`${message.type()}: ${message.text()}`));
      page.on('pageerror', (error) => seen.push(error.message));
      page.on('response', (res) => {
        if (res.url().includes('__field-notes'))
          seen.push(`${res.request().method()} ${String(res.status())}`);
      });
      await page.goto(`http://localhost:${String(port)}/`);
      await page.waitForFunction(() => 'handle' in window);
      await page.evaluate(() => (window as { handle?: { open(): Promise<void> } }).handle?.open());
      await page.locator('field-notes textarea').fill('From the Vite plugin');
      await page.keyboard.press('Control+Enter');
      const items = join(root, '.field-notes', 'items');
      let stored: string[] = [];
      for (let i = 0; i < 100 && stored.length === 0; i++) {
        await new Promise((done) => setTimeout(done, 100));
        stored = finishedNotes(items);
      }
      assert(
        stored.length === 1,
        `expected one note on disk, found ${String(stored.length)}\n${seen.join('\n')}`,
      );
      const note = readFileSync(join(items, stored[0] ?? '', 'note.md'), 'utf8');
      assert(note.includes('From the Vite plugin'), 'the note on disk is not the one sent');
    } finally {
      await browser.close();
      await server.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
);

if (process.exitCode) console.error('check-dist: FAILED');
else console.log('check-dist: ok');
