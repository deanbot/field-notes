// Shared by the e2e specs: finding a note on disk, the built CLI, and
// collecting what a page complains about.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export const REPO = join(import.meta.dirname, '../..');

/** Ports nothing else should be using, so a test never reaches someone's own server. */
export const PORTS = { viteVueDev: 5791, viteVueExport: 5792 } as const;

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
export async function noteWith(dir: string, marker: string): Promise<Listed> {
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
