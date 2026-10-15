// The no-build path: a bare HTML page with a script tag from `field-notes
// serve`, on another origin than the page.
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { PORTS, captureOne, problems } from './helpers.ts';

const NOTES = join(import.meta.dirname, 'fixtures/script-tag/.field-notes');

test('a note with a picked element and a screenshot lands on disk', async ({
  page,
  browserName,
}) => {
  const seen = problems(page);
  await page.goto(`http://localhost:${String(PORTS.scriptTagPage)}/`);
  await expect(page.locator('field-notes')).toHaveCount(1);
  await captureOne(page, NOTES, `${browserName} ${randomUUID()}`);
  expect(seen).toEqual([]);
});
