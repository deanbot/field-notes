// Export mode (#15): the outbox is the store, and a zip is the artifact.
// A lazy chunk of its own (fflate and yaml come with core's bundle writer),
// loaded on the first export. Only the npm build has it: the script-tag
// build is served by the local sink, so it's always local mode.
import { type BundleItem, writeBundle } from '@field-notes/core/bundle';
import { type Note, NoteSchema, isAttachmentName } from '@field-notes/core/note';
import type { Outbox, OutboxEntry } from './outbox.ts';
import { type Attachments, type Receipt, type Transport, TransportError } from './transport.ts';

export interface ExportTransport {
  /** "Stores" a note in the next zip. The receipt id is the note's own id. */
  readonly transport: Transport;
  /** What it holds, in the order it was given. */
  readonly stored: () => { note: Note; attachments: Attachments }[];
  /** The zip of everything it holds. */
  readonly zip: (exportedAt: Date) => Promise<Uint8Array>;
}

export function createExportTransport(): ExportTransport {
  const held = new Map<string, { note: Note; attachments: Attachments; receipt: Receipt }>();
  return {
    transport: (note, attachments) => {
      if (!NoteSchema.safeParse(note).success) {
        return Promise.reject(new TransportError(`invalid note ${note.id}`, { retryable: false }));
      }
      const bad = Object.keys(attachments).find((name) => !isAttachmentName(name));
      if (bad !== undefined) {
        return Promise.reject(
          new TransportError(`bad attachment name: ${bad}`, { retryable: false }),
        );
      }
      const existing = held.get(note.id);
      if (existing) return Promise.resolve(existing.receipt);
      const receipt = { id: note.id };
      held.set(note.id, { note: structuredClone(note), attachments: { ...attachments }, receipt });
      return Promise.resolve(receipt);
    },
    stored: () => [...held.values()].map(({ note, attachments }) => ({ note, attachments })),
    zip: async (exportedAt) => {
      const items = await Promise.all(
        [...held.values()].map(async ({ note, attachments }): Promise<BundleItem> => ({
          note,
          attachments: Object.fromEntries(
            await Promise.all(
              Object.entries(attachments).map(
                async ([name, blob]) => [name, new Uint8Array(await blob.arrayBuffer())] as const,
              ),
            ),
          ),
        })),
      );
      return writeBundle(items, { exportedAt });
    },
  };
}

/** `field-notes-<YYYY-MM-DD-HHmm>.zip`, in local time. */
export function exportFileName(at: Date): string {
  const two = (n: number): string => String(n).padStart(2, '0');
  return `field-notes-${String(at.getFullYear())}-${two(at.getMonth() + 1)}-${two(at.getDate())}-${two(at.getHours())}${two(at.getMinutes())}.zip`;
}

function download(zip: Uint8Array, name: string): void {
  const url = URL.createObjectURL(
    new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  // Not at once: a browser may still be starting the download.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60_000);
}

async function zipOf(entries: readonly OutboxEntry[], at: Date): Promise<Uint8Array> {
  const { transport, zip } = createExportTransport();
  for (const { note, attachments } of entries) await transport(note, attachments);
  return zip(at);
}

/**
 * Zips every unexported note and downloads it; they become the last export,
 * replacing the one before. Resolves with how many were exported.
 */
export async function exportNotes(outbox: Outbox, at: Date = new Date()): Promise<number> {
  const entries = (await outbox.list()).filter((entry) => entry.state === 'pending');
  if (!entries.length) return 0;
  download(await zipOf(entries, at), exportFileName(at));
  // Only these: a note added meanwhile waits for the next export.
  await outbox.markExported(
    entries.map((entry) => entry.id),
    at.getTime(),
  );
  return entries.length;
}

/** Downloads the last export again: the same zip, rebuilt from the same notes. */
export async function downloadLastExport(outbox: Outbox): Promise<boolean> {
  const entries = (await outbox.list()).filter((entry) => entry.state === 'exported');
  const at = entries[0]?.exportedAt;
  if (at === undefined) return false;
  download(await zipOf(entries, new Date(at)), exportFileName(new Date(at)));
  return true;
}
