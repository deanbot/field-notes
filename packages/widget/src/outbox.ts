// The outbox: every note is stored here (IndexedDB) before any transport
// sees it, so notes survive reloads and a sink that's down. Part of the panel
// chunk. It reports the pending count after every committed change, and the
// stub mirrors it to localStorage for the badge.
import { ulid } from '@field-notes/core/id';
import { type Note, NoteSchema, isAttachmentName } from '@field-notes/core/note';
import { type DBSchema, type IDBPDatabase, openDB } from 'idb';
import { type Attachments, type Receipt, type Transport, TransportError } from './transport.ts';

/**
 * `pending`: not delivered yet. `delivered`: a transport has it. `exported`:
 * in a downloaded zip (export mode, #15).
 */
export type OutboxState = 'pending' | 'delivered' | 'exported';

export interface OutboxEntry {
  readonly id: string;
  readonly note: Note;
  readonly attachments: Attachments;
  readonly state: OutboxState;
  /** When it was added, in ms: the outbox's order. */
  readonly added: number;
  readonly receipt?: Receipt | undefined;
  /** When a transport took it (ms). */
  readonly deliveredAt?: number | undefined;
  /** When it went into the last export's zip (ms); the zip's own date. */
  readonly exportedAt?: number | undefined;
  /** Failed sends so far. */
  readonly attempts: number;
  readonly lastError?: string | undefined;
  /** Set when a transport rejected it for good; flush() skips it. */
  readonly rejected?: boolean | undefined;
  /**
   * When a flush started sending it (ms). Edits and deletes are refused
   * meanwhile: the transport would store the old text. See `SEND_LEASE_MS`.
   */
  readonly sending?: number | undefined;
}

/**
 * How long a send may hold a note. A mark older than this is treated as
 * clear, so a tab that closed or crashed mid-send can't lock the note.
 */
export const SEND_LEASE_MS = 60_000;

/** Whether a flush, in this tab or another, is sending the entry now. */
export function isSending(entry: Pick<OutboxEntry, 'sending'>): boolean {
  return entry.sending !== undefined && Date.now() - entry.sending < SEND_LEASE_MS;
}

/** What the drawer may change. */
export interface NoteEdit {
  readonly body: string;
  readonly type?: string | undefined;
}

export interface FlushResult {
  readonly delivered: number;
  /** Rejected for good and skipped. */
  readonly rejected: number;
  /** True when a retryable failure stopped the flush. */
  readonly stopped: boolean;
}

export interface Outbox {
  readonly add: (note: Note, attachments?: Attachments) => Promise<void>;
  /** Every entry, oldest first. */
  readonly list: () => Promise<OutboxEntry[]>;
  readonly pendingCount: () => Promise<number>;
  /**
   * Changes a pending note; rejects for any other state. A note a send was
   * already tried for gets a new id (see the comment in `edit`).
   */
  readonly edit: (id: string, edit: NoteEdit) => Promise<OutboxEntry>;
  /** Forgets an entry, whatever its state. */
  readonly remove: (id: string) => Promise<void>;
  /** Sends pending notes, oldest first (see FlushResult). */
  readonly flush: (transport: Transport) => Promise<FlushResult>;
  /**
   * Marks these pending notes as the last export, at `at` (ms), and forgets
   * the export before. A note no longer pending is left as it is.
   */
  readonly markExported: (ids: readonly string[], at: number) => Promise<void>;
  /** Forgets delivered or exported notes that reached that state more than `age` ms ago. */
  readonly prune: (state: 'delivered' | 'exported', age: number) => Promise<void>;
  readonly close: () => void;
}

// Attachments are stored as bytes, not Blobs: WebKit can't put a Blob in
// IndexedDB in some contexts (private browsing), and bytes work everywhere.
interface StoredAttachment {
  readonly type: string;
  readonly bytes: ArrayBuffer;
}
type StoredEntry = Omit<OutboxEntry, 'attachments'> & {
  readonly attachments: Readonly<Record<string, StoredAttachment>>;
};

interface OutboxDB extends DBSchema {
  entries: {
    key: string;
    value: StoredEntry;
    indexes: { state: OutboxState };
  };
}

async function toStored(attachments: Attachments): Promise<StoredEntry['attachments']> {
  const pairs = await Promise.all(
    Object.entries(attachments).map(async ([name, blob]): Promise<[string, StoredAttachment]> => [
      name,
      { type: blob.type, bytes: await blob.arrayBuffer() },
    ]),
  );
  return Object.fromEntries(pairs);
}

function fromStored(entry: StoredEntry): OutboxEntry {
  const attachments = Object.fromEntries(
    Object.entries(entry.attachments).map(([name, { type, bytes }]) => [
      name,
      new Blob([bytes], { type }),
    ]),
  );
  return { ...entry, attachments };
}

export const DB_NAME = 'field-notes';
const DB_VERSION = 1;

function checkAttachments(attachments: Attachments): void {
  for (const name of Object.keys(attachments)) {
    if (!isAttachmentName(name))
      throw new TypeError(`bad attachment name: ${JSON.stringify(name)}`);
  }
}

/**
 * Opens the outbox lazily, on first use. Aborting `signal` (unmount) closes
 * the connection. `changed` hears the pending count after every change.
 */
export function createOutbox(
  signal: AbortSignal,
  changed: (pending: number) => void = () => undefined,
): Outbox {
  let connection: Promise<IDBPDatabase<OutboxDB>> | undefined;
  // Strictly increasing, so two notes added in one millisecond keep their order.
  let lastAdded = 0;

  const db = (): Promise<IDBPDatabase<OutboxDB>> => {
    if (signal.aborted) return Promise.reject(new DOMException('unmounted', 'AbortError'));
    connection ??= openDB<OutboxDB>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        const store = database.createObjectStore('entries', { keyPath: 'id' });
        store.createIndex('state', 'state');
      },
      // Another copy of the widget (script tag and npm import) wants a newer
      // version: let it upgrade, and reopen on next use.
      blocking() {
        close();
      },
      terminated() {
        connection = undefined;
      },
    }).catch((error: unknown) => {
      connection = undefined;
      throw error;
    });
    return connection;
  };

  const close = (): void => {
    const open = connection;
    connection = undefined;
    void open?.then(
      (database) => {
        database.close();
      },
      () => undefined,
    );
  };
  signal.addEventListener('abort', close, { once: true });

  const pendingCount = async (): Promise<number> =>
    (await db()).countFromIndex('entries', 'state', 'pending');

  // After a committed change, so the count never runs ahead of the database.
  const committed = async (): Promise<void> => {
    changed(await pendingCount());
  };

  const list = async (): Promise<OutboxEntry[]> => {
    const all = await (await db()).getAll('entries');
    return all.sort((a, b) => a.added - b.added).map(fromStored);
  };

  const update = async (
    id: string,
    change: (entry: StoredEntry) => StoredEntry | undefined,
  ): Promise<StoredEntry | undefined> => {
    const tx = (await db()).transaction('entries', 'readwrite');
    // Awaited with the request, so an aborted transaction can't go unhandled.
    const [next] = await Promise.all([
      tx.store.get(id).then(async (entry) => {
        const changed = entry && change(entry);
        if (changed) await tx.store.put(changed);
        return changed;
      }),
      tx.done,
    ]);
    return next;
  };

  return {
    add: async (note, attachments = {}) => {
      NoteSchema.parse(note);
      checkAttachments(attachments);
      // Read before the transaction: it would close while awaiting the bytes.
      const stored = await toStored(attachments);
      const added = Math.max(Date.now(), lastAdded + 1);
      lastAdded = added;
      const tx = (await db()).transaction('entries', 'readwrite');
      // Both at once: a failed add (a duplicate id) aborts the transaction,
      // and tx.done must not reject unheard.
      await Promise.all([
        tx.store.add({
          id: note.id,
          note,
          attachments: stored,
          state: 'pending',
          added,
          attempts: 0,
        }),
        tx.done,
      ]);
      await committed();
    },

    list,
    pendingCount: async () => {
      const count = await pendingCount();
      changed(count); // Lets a stale badge correct itself.
      return count;
    },

    edit: async (id, edit) => {
      const tx = (await db()).transaction('entries', 'readwrite');
      let reason = 'not found';
      const [result] = await Promise.all([
        tx.store.get(id).then(async (entry) => {
          if (!entry) return undefined;
          if (entry.state !== 'pending') {
            reason = `already ${entry.state}`;
            return undefined;
          }
          if (isSending(entry)) {
            reason = 'being sent';
            return undefined;
          }
          const note: Note = { ...entry.note, body: edit.body };
          if (edit.type) note.type = edit.type;
          else delete note.type;
          if (!entry.attempts) {
            // The same rules as a new note; id and created stay as they were.
            const next: StoredEntry = { ...entry, note: NoteSchema.parse(note) };
            await tx.store.put(next);
            return next;
          }
          // A failed send may still have reached the sink (a timeout), and a
          // resend of the same id would get that old text's receipt. Under a
          // new id the edit is sent as a note of its own: at worst the old
          // text is stored too, never the edit lost.
          note.id = ulid();
          const { lastError: _error, rejected: _rejected, ...rest } = entry;
          const next: StoredEntry = {
            ...rest,
            id: note.id,
            note: NoteSchema.parse(note),
            attempts: 0,
          };
          await tx.store.add(next);
          await tx.store.delete(id);
          return next;
        }),
        tx.done,
      ]);
      if (!result) throw new Error(`can't edit note ${id}: ${reason}`);
      return fromStored(result);
    },

    remove: async (id) => {
      const tx = (await db()).transaction('entries', 'readwrite');
      const [busy] = await Promise.all([
        tx.store.get(id).then(async (entry) => {
          // The transport would still store it: refuse rather than pretend.
          if (entry && isSending(entry)) return true;
          await tx.store.delete(id);
          return false;
        }),
        tx.done,
      ]);
      if (busy) throw new Error(`can't delete note ${id}: being sent`);
      await committed();
    },

    flush: async (send) => {
      let delivered = 0;
      let rejected = 0;
      for (const { id } of await list()) {
        // Claim it in the transaction that reads it, so neither another tab's
        // flush nor an edit can touch it until the send settles.
        const claimed = await update(id, (current) =>
          current.state === 'pending' && !current.rejected && !isSending(current)
            ? { ...current, sending: Date.now() }
            : undefined,
        );
        if (!claimed) continue;
        const { note, attachments } = fromStored(claimed);
        const settle = (change: Partial<StoredEntry>): Promise<unknown> =>
          update(id, ({ sending: _done, ...current }) => ({ ...current, ...change }));
        try {
          const receipt = await send(note, attachments);
          await settle({ state: 'delivered', receipt, deliveredAt: Date.now() });
          delivered++;
        } catch (error) {
          const retryable = !(error instanceof TransportError) || error.retryable;
          const lastError = error instanceof Error ? error.message : String(error);
          await settle({
            attempts: claimed.attempts + 1,
            lastError,
            ...(retryable ? {} : { rejected: true }),
          });
          if (retryable) {
            await committed();
            return { delivered, rejected, stopped: true };
          }
          rejected++;
        }
      }
      await committed();
      return { delivered, rejected, stopped: false };
    },

    markExported: async (ids, at) => {
      const tx = (await db()).transaction('entries', 'readwrite');
      const mark = async (): Promise<void> => {
        const index = tx.store.index('state');
        for (
          let cursor = await index.openCursor('exported');
          cursor;
          cursor = await cursor.continue()
        ) {
          await cursor.delete();
        }
        for (const id of ids) {
          const entry = await tx.store.get(id);
          if (entry?.state === 'pending')
            await tx.store.put({ ...entry, state: 'exported', exportedAt: at });
        }
      };
      await Promise.all([mark(), tx.done]);
      await committed();
    },

    prune: async (state, age) => {
      const cutoff = Date.now() - age;
      const tx = (await db()).transaction('entries', 'readwrite');
      const index = tx.store.index('state');
      const sweep = async (): Promise<void> => {
        for (let cursor = await index.openCursor(state); cursor; cursor = await cursor.continue()) {
          const { deliveredAt, exportedAt, added } = cursor.value;
          // Entries delivered before deliveredAt existed fall back to when they were added.
          const since = (state === 'delivered' ? deliveredAt : exportedAt) ?? added;
          if (since < cutoff) await cursor.delete();
        }
      };
      await Promise.all([sweep(), tx.done]);
    },

    close,
  };
}
