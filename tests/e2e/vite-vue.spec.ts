// examples/vite-vue: the Vite plugin in local mode, the export-mode build,
// and a production build that leaves the widget out.
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  PORTS,
  REPO,
  captureOne,
  fieldNotes,
  isPng,
  listNotes,
  open,
  problems,
  submit,
  trigger,
  WIDGET_MARKERS,
} from './helpers.ts';

const EXAMPLE = join(REPO, 'examples/vite-vue');
const DEV = `http://localhost:${String(PORTS.viteVueDev)}/`;
const EXPORT = `http://localhost:${String(PORTS.viteVueExport)}/`;

test('local mode: a note with a picked element and a screenshot lands on disk', async ({
  page,
  browserName,
}) => {
  const seen = problems(page);
  await page.goto(DEV);
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  // The <field-notes> in the app's template carries the widget.
  await expect(page.locator('main field-notes')).toHaveCount(1);
  await captureOne(page, join(EXAMPLE, '.field-notes'), `${browserName} ${randomUUID()}`);
  // No Vue warnings (such as one for an unknown <field-notes> element), no errors.
  expect(seen).toEqual([]);
});

test('export mode: three notes, exported as a zip, imported by the CLI', async ({
  page,
  browserName,
}) => {
  const seen = problems(page);
  await page.goto(EXPORT);
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  // The app's <field-notes> is there, but empty until ?field-notes=1.
  await expect(page.locator('field-notes')).toHaveCount(1);
  await expect(trigger(page)).toHaveCount(0);

  await page.goto(`${EXPORT}?field-notes=1`);
  const marker = `${browserName} ${randomUUID()}`;
  for (const n of [1, 2, 3]) {
    await open(page);
    await submit(page, `Export note ${String(n)}. ${marker}`);
  }
  await expect(trigger(page)).toHaveAccessibleName('Field notes, 3 pending');

  await open(page);
  await page.getByRole('button', { name: /^My notes/ }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export (3)' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^field-notes-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/);
  await expect(trigger(page)).toHaveAccessibleName('Field notes');

  const project = mkdtempSync(join(tmpdir(), 'field-notes-e2e-'));
  try {
    const zip = join(project, download.suggestedFilename());
    writeFileSync(zip, readFileSync(await download.path()));
    const notes = join(project, '.field-notes');
    fieldNotes('import', zip, '--dir', notes);
    const imported = listNotes(notes);
    expect(imported.map((item) => item.note.body).sort()).toEqual(
      [1, 2, 3].map((n) => `Export note ${String(n)}. ${marker}`),
    );
    for (const { screenshot } of imported) expect(isPng(screenshot ?? '')).toBe(true);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
  expect(seen).toEqual([]);
});

test('a production build without activation has no widget code', ({ browserName }) => {
  test.skip(browserName !== 'chromium', 'reads the build, not a page: once is enough');
  const dist = join(EXAMPLE, 'dist/local');
  const files = readdirSync(dist, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
  // The app, in one chunk: no lazy widget chunks.
  expect(files.filter((file) => file.endsWith('.js'))).toHaveLength(1);
  const code = files.map((file) => readFileSync(file, 'utf8')).join('\n');
  expect(code.includes('Place order'), 'the app is missing').toBe(true);
  for (const marker of WIDGET_MARKERS) expect(code.includes(marker), marker).toBe(false);
});
