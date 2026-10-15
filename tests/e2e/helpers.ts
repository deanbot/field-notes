// Shared by the e2e specs: finding a note on disk, the built CLI, and
// collecting what a page complains about.
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

export const REPO = join(import.meta.dirname, '../..');

/** Ports nothing else should be using, so a test never reaches someone's own server. */
export const PORTS = {
  viteVueDev: 5791,
  viteVueExport: 5792,
  scriptTagSink: 5793,
  scriptTagPage: 5794,
  next: 5795,
} as const;

/** The built `field-notes` bin, as users get it. */
const CLI = join(REPO, 'packages/field-notes/dist/cli.js');

/** Runs the built CLI, failing the test if it exits with anything but 0. */
export function fieldNotes(...args: string[]): string {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}

/** A note as `field-notes list --json` prints it. */
export interface Listed {
  readonly dir: string;
  readonly screenshot: string | null;
  readonly note: {
    readonly id: string;
    readonly body: string;
    readonly element?: { readonly selector: string } | null;
    readonly [key: string]: unknown;
  };
}

/** Every note in a notes directory, read by the built CLI, which validates each one. */
export const listNotes = (dir: string): Listed[] =>
  JSON.parse(fieldNotes('list', '--status', 'all', '--json', '--dir', dir)) as Listed[];

/**
 * Waits for the note whose body contains `marker` to land in the notes
 * directory `dir`. Each test's marker is unique, so notes from other
 * browsers or earlier runs never match.
 */
async function noteWith(dir: string, marker: string): Promise<Listed> {
  let found: Listed | undefined;
  await expect
    .poll(
      () => {
        found = listNotes(dir).find((item) => item.note.body.includes(marker));
        return found;
      },
      { timeout: 15_000 },
    )
    .toBeDefined();
  if (!found) throw new Error(`no note with ${marker}`);
  return found;
}

/** Console warnings and errors, and uncaught errors, from `page`. */
export function problems(page: Page): string[] {
  const seen: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      seen.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => seen.push(`pageerror: ${error.message}`));
  return seen;
}

/** The widget's floating button. Its label is "Field notes", plus any pending count. */
export const trigger = (page: Page): Locator =>
  page.getByRole('button', { name: /^Field notes(, \d+ pending)?$/ });

/** Opens the widget with its button and waits for its screenshot of the page. */
export async function open(page: Page): Promise<void> {
  await trigger(page).click();
  await expect(page.locator('field-notes .shot img[src^="blob:"]')).toBeVisible();
}

/** Picks `target` with the element picker. Its layer takes the pointer: aim, then click. */
async function pick(page: Page, target: Locator): Promise<void> {
  await page.getByRole('button', { name: 'Pick element' }).click();
  const box = await target.boundingBox();
  if (!box) throw new Error('the element to pick is not on screen');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole('button', { name: /^Picked .*Pick again$/ })).toBeVisible();
}

/** Writes the note and sends it with Ctrl+Enter, waiting for the form to close. */
export async function submit(page: Page, text: string): Promise<void> {
  await page.locator('#field-notes-text').fill(text);
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('#field-notes-text')).toHaveCount(0);
}

/** Whether `file` starts with the PNG signature. */
export const isPng = (file: string): boolean =>
  readFileSync(file)
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

/**
 * The flow every example shares: open the widget, pick the "Place order"
 * button, send a note, and find it in the notes directory `dir`. Checks the
 * picked element and the screenshot, then deletes the note.
 */
export async function captureOne(page: Page, dir: string, marker: string): Promise<void> {
  await open(page);
  await pick(page, page.getByRole('button', { name: 'Place order' }));
  await submit(page, `The order button should say "Pay now". ${marker}`);
  const { dir: noteDir, screenshot, note } = await noteWith(dir, marker);
  try {
    const selector = note.element?.selector ?? '';
    const picked = await page.evaluate(
      (s) => document.querySelector(s)?.textContent.trim(),
      selector,
    );
    expect(picked, `selector ${selector}`).toBe('Place order');
    expect(screenshot).not.toBeNull();
    expect(isPng(screenshot ?? '')).toBe(true);
  } finally {
    rmSync(noteDir, { recursive: true, force: true });
  }
}

/** Strings only widget code has: its tag and endpoint, Lit and Zod. */
export const WIDGET_MARKERS = ['field-notes', '__field-notes', 'litHtmlVersions', '_zod'];
