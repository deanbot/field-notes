// Vitest browser commands: what the browser itself logs to the console.
// Some warnings come from the engine, not `console.warn`, so a spy in the
// page can't see them; Playwright can. Browser tests call these through
// `commands` from 'vitest/browser' (typed in packages/widget/src/test-console.ts).
import type {} from '@vitest/browser-playwright';
import type { Page } from 'playwright';
import type { BrowserCommandContext } from 'vitest/node';

/** Each page's console warnings and errors since its last `consoleWatch`. */
const seen = new WeakMap<Page, string[]>();

/** Starts (or restarts) collecting the calling page's console warnings and errors. */
function consoleWatch({ page }: BrowserCommandContext): void {
  if (!seen.has(page)) {
    page.on('console', (message) => {
      if (message.type() === 'warning' || message.type() === 'error') {
        seen.get(page)?.push(`${message.type()}: ${message.text()}`);
      }
    });
  }
  seen.set(page, []);
}

/**
 * What's been collected since `consoleWatch`. Console events reach Node
 * after the command that follows them: a round trip to the test's frame
 * first lets them arrive.
 */
async function consoleSeen(context: BrowserCommandContext): Promise<string[]> {
  await (await context.frame()).evaluate(() => undefined);
  return [...(seen.get(context.page) ?? [])];
}

export const consoleCommands = { consoleWatch, consoleSeen };
