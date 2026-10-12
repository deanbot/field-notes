// A real sink for browser tests, run in Node by the Vitest commands in
// scripts/vitest-sink.ts. One at a time: browser test files run one by one.
import type { Note } from '@field-notes/core/note';
import { commands } from 'vitest/browser';
import type { StoredNote } from './transport.contract.ts';

declare module 'vitest/browser' {
  interface BrowserCommands {
    sinkStart: () => Promise<{ endpoint: string; token: string }>;
    sinkStop: () => Promise<void>;
    sinkReset: () => Promise<void>;
    sinkHanging: () => Promise<string>;
    sinkNotes: () => Promise<{ note: Note; attachments: Record<string, string> }[]>;
  }
}

/** Starts the sink, or restarts it on the same port after `stopSink`. */
export const startSink = (): Promise<{ endpoint: string; token: string }> => commands.sinkStart();
/** The sink goes down; its notes stay. */
export const stopSink = (): Promise<void> => commands.sinkStop();
/** Down, and its notes gone. */
export const resetSink = (): Promise<void> => commands.sinkReset();

/** An endpoint that takes requests and never answers. */
export const hangingEndpoint = (): Promise<string> => commands.sinkHanging();

/** What the sink has stored. */
export async function sinkNotes(): Promise<StoredNote[]> {
  return (await commands.sinkNotes()).map(({ note, attachments }) => ({
    note,
    attachments: Object.fromEntries(
      Object.entries(attachments).map(([name, base64]) => [
        name,
        new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))]),
      ]),
    ),
  }));
}
