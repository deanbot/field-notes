// examples/next: React 19 with server rendering, and the field-notes
// middleware on a custom server.
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { PORTS, REPO, WIDGET_MARKERS, captureOne, open, problems, trigger } from './helpers.ts';

const EXAMPLE = join(REPO, 'examples/next');
const URL = `http://localhost:${String(PORTS.next)}/`;

test('the server renders the page, and leaves the widget to the browser', async ({ request }) => {
  const html = await (await request.get(URL)).text();
  expect(html).toContain('<h1>Checkout</h1>');
  // The element from the layout's JSX, empty: the browser mounts the widget.
  expect(html).toContain('<field-notes position="bottom-right"></field-notes>');
});

test('the <field-notes> in the JSX carries the widget, and only it', async ({ page }) => {
  const seen = problems(page);
  await page.goto(URL);
  await expect(trigger(page)).toBeVisible();
  // One element, the layout's: the widget added none of its own.
  await expect(page.locator('field-notes')).toHaveCount(1);
  await expect(page.locator('field-notes[position="bottom-right"]')).toHaveCount(1);
  expect(seen).toEqual([]);
});

test('a note with a picked element and a screenshot lands on disk', async ({
  page,
  browserName,
}) => {
  const seen = problems(page);
  await page.goto(URL);
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  await captureOne(page, join(EXAMPLE, '.field-notes'), `${browserName} ${randomUUID()}`);
  // No hydration errors, and nothing from React running effects twice.
  expect(seen).toEqual([]);
});

test('opening the widget, again and again, logs nothing in Firefox', async ({
  page,
  browserName,
}) => {
  // Firefox laid out the screenshot's style frame while it loaded, with the
  // page, and warned "Layout was forced before the page was fully loaded":
  // in about half of opens, so ten of them.
  test.skip(browserName !== 'firefox', "the warning is Firefox's");
  const seen = problems(page);
  for (let i = 0; i < 10; i++) {
    await page.goto(URL);
    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
    await open(page);
  }
  expect(seen).toEqual([]);
});

test('a production build sends no widget code to the browser', ({ browserName }) => {
  test.skip(browserName !== 'chromium', 'reads the build, not a page: once is enough');
  // What `next build` sends to browsers. Server code may name the widget:
  // the client component is rendered on the server too.
  const dir = join(EXAMPLE, '.next/static');
  const files = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => join(entry.parentPath, entry.name));
  const code = files.map((file) => readFileSync(file, 'utf8')).join('\n');
  expect(code.includes('Place order'), 'the app is missing').toBe(true);
  for (const marker of WIDGET_MARKERS) expect(code.includes(marker), marker).toBe(false);
});
