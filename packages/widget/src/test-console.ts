// The browser's own console, seen from Playwright by the Vitest commands in
// scripts/vitest-console.ts: engine warnings that a `console` spy misses.
import { commands } from 'vitest/browser';

declare module 'vitest/browser' {
  interface BrowserCommands {
    consoleWatch: () => Promise<void>;
    consoleSeen: () => Promise<string[]>;
  }
}

/** Starts collecting console warnings and errors, forgetting earlier ones. */
export const watchConsole = (): Promise<void> => commands.consoleWatch();

/** Warnings and errors logged since `watchConsole`. */
export const consoleSeen = (): Promise<string[]> => commands.consoleSeen();
