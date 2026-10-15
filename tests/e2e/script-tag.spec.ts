// The no-build path: a bare HTML page with a script tag from `field-notes
// serve`, on another origin than the page.
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  PORTS,
  captureOne,
  listNotes,
  open,
  problems,
  startSink,
  submit,
  trigger,
} from './helpers.ts';
import type { Sink } from './helpers.ts';

const NOTES = join(import.meta.dirname, 'fixtures/script-tag/.field-notes');
const PAGE = `http://localhost:${String(PORTS.scriptTagPage)}/`;

test('a note with a picked element and a screenshot lands on disk', async ({
  page,
  browserName,
}) => {
  const seen = problems(page);
  await page.goto(PAGE);
  await expect(page.locator('field-notes')).toHaveCount(1);
  await captureOne(page, NOTES, `${browserName} ${randomUUID()}`);
  expect(seen).toEqual([]);
});

test('a note left while the sink is down waits, and lands once when it is back', async ({
  page,
  browserName,
}) => {
  // Retries back off (1 s, 2 s, 4 s…), so the sink may be back a while before the next one.
  test.setTimeout(60_000);
  const port = PORTS.ownSink[browserName];
  const dir = mkdtempSync(join(tmpdir(), 'field-notes-e2e-'));
  const notes = join(dir, '.field-notes');
  const marker = `${browserName} ${randomUUID()}`;
  const mine = (): number =>
    listNotes(notes).filter((item) => item.note.body.includes(marker)).length;
  const seen = problems(page);
  let sink: Sink | undefined = await startSink(port, notes);
  try {
    await page.goto(`${PAGE}?sink=${String(port)}`);
    await expect(page.locator('field-notes')).toHaveCount(1);

    await sink.stop();
    sink = undefined;
    await open(page);
    await submit(page, `Sent while the sink was down. ${marker}`);
    await expect(trigger(page)).toHaveAccessibleName('Field notes, 1 pending');
    expect(mine()).toBe(0);

    // Back on the same port and directory. Nothing on the page is touched
    // from here: only the widget's own retry can send the note.
    sink = await startSink(port, notes);
    await expect(trigger(page)).toHaveAccessibleName('Field notes', { timeout: 30_000 });
    expect(mine()).toBe(1);
    // A second send would land as a second note: give one time to show up.
    await page.waitForTimeout(2000);
    expect(mine()).toBe(1);
  } finally {
    await sink?.stop();
    rmSync(dir, { recursive: true, force: true });
  }
  // Failed fetches log the browser's own network errors, and WebKit reports
  // one as a page error even when it's caught. The widget adds nothing.
  const unexpected = seen.filter(
    (line) =>
      (line.startsWith('pageerror') && !line.endsWith('due to access control checks.')) ||
      line.includes('[field-notes]'),
  );
  expect(unexpected).toEqual([]);
});
