// examples/vite-vue: the Vite plugin in local mode, the export-mode build,
// and a production build that leaves the widget out.
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Locator, type Page, expect, test } from '@playwright/test';
import { PORTS, REPO, fieldNotes, listNotes, noteWith, problems } from './helpers.ts';

const EXAMPLE = join(REPO, 'examples/vite-vue');
const DEV = `http://localhost:${String(PORTS.viteVueDev)}/`;
const EXPORT = `http://localhost:${String(PORTS.viteVueExport)}/`;

/** The widget's floating button. Its label is "Field notes", plus any pending count. */
const trigger = (page: Page): Locator =>
  page.getByRole('button', { name: /^Field notes(, \d+ pending)?$/ });

/** Opens the widget and waits for its screenshot of the page. */
async function open(page: Page): Promise<void> {
  await trigger(page).click();
  await expect(page.locator('field-notes .shot img[src^="blob:"]')).toBeVisible();
}

/** Writes the note and sends it with Ctrl+Enter, waiting for the surface to close. */
async function submit(page: Page, text: string): Promise<void> {
  await page.locator('#field-notes-text').fill(text);
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('#field-notes-text')).toHaveCount(0);
}

const PNG = [137, 80, 78, 71, 13, 10, 26, 10];

test('local mode: a note with a picked element and a screenshot lands on disk', async ({
  page,
  browserName,
}) => {
  const seen = problems(page);
  await page.goto(DEV);
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  await open(page);

  // The picker's layer takes the pointer: aim, then click, as a mouse does.
  await page.getByRole('button', { name: 'Pick element' }).click();
  const box = await page.getByRole('button', { name: 'Place order' }).boundingBox();
  if (!box) throw new Error('Place order is not on screen');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole('button', { name: /^Picked .*Pick again$/ })).toBeVisible();

  const marker = `${browserName} ${randomUUID()}`;
  await submit(page, `The order button should say "Pay now". ${marker}`);

  const { dir, screenshot, note } = await noteWith(join(EXAMPLE, '.field-notes'), marker);
  try {
    const selector = note.element?.selector ?? '';
    const picked = await page.evaluate(
      (s) => document.querySelector(s)?.textContent.trim(),
      selector,
    );
    expect(picked, `selector ${selector}`).toBe('Place order');
    expect(screenshot).not.toBeNull();
    expect([...readFileSync(screenshot ?? '').subarray(0, 8)]).toEqual(PNG);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
  await expect(page.locator('field-notes')).toHaveCount(0); // Off until ?field-notes=1.

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
    for (const { screenshot } of imported) {
      expect([...readFileSync(screenshot ?? '').subarray(0, 8)]).toEqual(PNG);
    }
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
  const scripts = files.filter((file) => file.endsWith('.js'));
  // The app, in one chunk: no lazy widget chunks.
  expect(scripts).toHaveLength(1);
  const code = files.map((file) => readFileSync(file, 'utf8')).join('\n');
  expect(code).toContain('Place order');
  for (const marker of ['field-notes', '__field-notes', 'litHtmlVersions', '_zod']) {
    expect(code, marker).not.toContain(marker);
  }
});
