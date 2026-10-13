// Writes notes into `.field-notes/items/`. Every file lands atomically
// (written to a temp name, then renamed), and `note.md` lands last, so a
// directory without one is still being written. Each note's directory is
// created exclusively, never reused.
import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Note, NoteSchema, noteDirName, serializeNote, ulid } from '@field-notes/core';

/** What the sink answers once a note is on disk. */
export interface Receipt {
  /** The id the sink gave the note. */
  readonly id: string;
  /** The note's directory, relative to the sink's directory (`items/<id>-<slug>`). */
  readonly dir: string;
}

interface Saved {
  readonly receipt: Receipt;
  /** False when `clientId` matched a note stored earlier. */
  readonly created: boolean;
}

/** A note that doesn't pass the schema once the sink has given it an id. */
export class InvalidNoteError extends Error {
  override readonly name = 'InvalidNoteError';
}

export interface StoreOptions {
  /** Written to `.gitignore` in `dir` if there's none yet; `false` writes none. */
  readonly gitignore: string | false;
}

export interface Store {
  /**
   * Gives `fields` an id and writes it with its attachments. With a
   * `clientId` seen before, writes nothing and returns the first receipt.
   */
  readonly save: (
    fields: Readonly<Record<string, unknown>>,
    attachments: ReadonlyMap<string, Uint8Array>,
    clientId?: string,
  ) => Promise<Saved>;
}

const NOTE_FILE = 'note.md';
const MAX_CLASHES = 8;

const hasCode = (error: unknown, code: string): boolean =>
  error instanceof Error && (error as NodeJS.ErrnoException).code === code;

/** Temp names start with a dot, which no attachment name can. */
async function writeAtomic(dir: string, name: string, data: string | Uint8Array): Promise<void> {
  const temp = join(dir, `.${name}.${randomUUID()}.tmp`);
  await writeFile(temp, data, { flag: 'wx' });
  await rename(temp, join(dir, name));
}

/** `.gitignore` for the sink's directory: nothing in it is tracked. */
export const DEFAULT_GITIGNORE = '*\n';

/**
 * Creates `dir/items/`, and `dir/.gitignore` if there's none (never
 * overwriting one the user edited). `false` writes no `.gitignore`.
 */
async function setUpSinkDir(
  dir: string,
  gitignore: string | false = DEFAULT_GITIGNORE,
): Promise<void> {
  await mkdir(join(dir, 'items'), { recursive: true });
  if (gitignore === false) return;
  await writeFile(join(dir, '.gitignore'), gitignore, { flag: 'wx' }).catch((error: unknown) => {
    if (!hasCode(error, 'EEXIST')) throw error;
  });
}

export function createStore(root: string, options: StoreOptions): Store {
  const items = join(root, 'items');
  // Client ids are hashed, so client text never becomes a path.
  const keys = join(root, '.sink', 'keys');
  const inFlight = new Map<string, Promise<Saved>>();
  let ready: Promise<void> | undefined;

  const prepare = (): Promise<void> => setUpSinkDir(root, options.gitignore);

  const write = async (
    fields: Readonly<Record<string, unknown>>,
    attachments: ReadonlyMap<string, Uint8Array>,
  ): Promise<Receipt> => {
    const setUp = (): Promise<void> =>
      (ready ??= prepare().catch((error: unknown) => {
        ready = undefined;
        throw error;
      }));
    await setUp();
    let recreated = false;
    for (let clash = 0; clash < MAX_CLASHES; clash++) {
      const checked = NoteSchema.safeParse({ ...fields, id: ulid() });
      if (!checked.success) throw new InvalidNoteError(checked.error.message);
      const note: Note = checked.data;
      const name = noteDirName(note);
      const dir = join(items, name);
      try {
        await mkdir(dir);
      } catch (error) {
        if (hasCode(error, 'EEXIST')) continue;
        // Someone deleted `.field-notes` while the sink ran: set it up again.
        if (hasCode(error, 'ENOENT') && !recreated) {
          recreated = true;
          ready = undefined;
          await setUp();
          continue;
        }
        throw error;
      }
      try {
        for (const [file, bytes] of attachments) await writeAtomic(dir, file, bytes);
        await writeAtomic(dir, NOTE_FILE, serializeNote(note));
      } catch (error) {
        await rm(dir, { recursive: true, force: true });
        throw error;
      }
      return { id: note.id, dir: `items/${name}` };
    }
    throw new Error(`no free note directory after ${String(MAX_CLASHES)} tries`);
  };

  const recorded = async (file: string): Promise<Receipt | undefined> => {
    try {
      return JSON.parse(await readFile(file, 'utf8')) as Receipt;
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return undefined;
      throw error;
    }
  };

  /**
   * Remembers which note a client id stored, after `note.md` has landed (a
   * crash in between means a rare duplicate, never a lost note). `link`
   * fails if the record exists, so a second process can't overwrite it.
   */
  const record = async (file: string, receipt: Receipt): Promise<Receipt> => {
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      await mkdir(keys, { recursive: true });
      await writeFile(temp, JSON.stringify(receipt), { flag: 'wx' });
      await link(temp, file);
      return receipt;
    } catch (error) {
      // This copy of the note goes either way: a failure must mean nothing
      // was stored (or every retry would store it again), and on EEXIST
      // another process stored the same note first, so keep theirs.
      await rm(join(root, receipt.dir), { recursive: true, force: true });
      const first = hasCode(error, 'EEXIST') ? await recorded(file) : undefined;
      if (!first) throw error;
      return first;
    } finally {
      await unlink(temp).catch(() => undefined);
    }
  };

  const save = async (
    fields: Readonly<Record<string, unknown>>,
    attachments: ReadonlyMap<string, Uint8Array>,
    clientId?: string,
  ): Promise<Saved> => {
    if (clientId === undefined) return { receipt: await write(fields, attachments), created: true };
    const key = createHash('sha256').update(clientId).digest('hex');
    // A retry can arrive while the first try is still writing (it timed out
    // on the client's side): wait for that one rather than write twice.
    const pending = inFlight.get(key);
    if (pending) return { receipt: (await pending).receipt, created: false };
    const file = join(keys, `${key}.json`);
    const saving = (async (): Promise<Saved> => {
      const known = await recorded(file);
      if (known) return { receipt: known, created: false };
      return { receipt: await record(file, await write(fields, attachments)), created: true };
    })();
    inFlight.set(key, saving);
    try {
      return await saving;
    } finally {
      // Successes are on disk now; a failure lets the next try start fresh.
      inFlight.delete(key);
    }
  };

  return { save };
}
