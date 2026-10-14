// Reads the backlog: every `items/*/note.md` under a notes directory. Notes
// are found by the id inside `note.md`, never by directory name (spec/SPEC.md).
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { type Note, parseNote } from '@field-notes/core';

/** A note and where it is on disk. */
export interface Item {
  /** The note's directory, absolute. */
  readonly dir: string;
  readonly note: Note;
}

/** A directory in `items/` that holds no readable note. */
interface Skipped {
  readonly dir: string;
  readonly reason: string;
}

export interface Backlog {
  /** Oldest first: by `created`, then `id`, then directory. */
  readonly items: readonly Item[];
  readonly skipped: readonly Skipped[];
}

const hasCode = (error: unknown, code: string): boolean =>
  error instanceof Error && (error as NodeJS.ErrnoException).code === code;

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Reads every note in `root/items/`. A missing `items/` is an empty backlog. */
export async function readBacklog(root: string): Promise<Backlog> {
  const itemsDir = join(root, 'items');
  let entries;
  try {
    entries = await readdir(itemsDir, { withFileTypes: true });
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return { items: [], skipped: [] };
    throw error;
  }
  const items: Item[] = [];
  const skipped: Skipped[] = [];
  // Symlinks aren't followed: a note's directory is a real directory.
  const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  await Promise.all(
    dirs.map(async (name) => {
      const dir = join(itemsDir, name);
      const read = await readItem(dir);
      if (read === undefined) return;
      if ('reason' in read) skipped.push(read);
      else items.push(read);
    }),
  );
  items.sort(
    (a, b) =>
      Date.parse(a.note.created) - Date.parse(b.note.created) ||
      compare(a.note.id, b.note.id) ||
      compare(a.dir, b.dir),
  );
  skipped.sort((a, b) => compare(a.dir, b.dir));
  return { items, skipped };
}

/** Undefined for a directory without `note.md`: it's still being written. */
async function readItem(dir: string): Promise<Item | Skipped | undefined> {
  const file = join(dir, 'note.md');
  let text;
  try {
    if (!(await lstat(file)).isFile()) return { dir, reason: 'note.md is not a file' };
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return undefined;
    return { dir, reason: `can't read note.md: ${(error as Error).message}` };
  }
  const parsed = parseNote(text);
  if (parsed.ok) return { dir, note: parsed.value };
  const { error } = parsed;
  if (error.issues.some((issue) => issue.path === 'schema')) {
    return { dir, reason: 'its schema is not 1: a newer field-notes may read it' };
  }
  return { dir, reason: error.message };
}

export type Found =
  | { readonly ok: true; readonly item: Item }
  | { readonly ok: false; readonly matches: readonly Item[] };

/**
 * The note whose id is `id`, or starts with it, ignoring case. Fails with no
 * matches, or with every match when more than one note fits.
 */
export function findNote(items: readonly Item[], id: string): Found {
  const wanted = id.toUpperCase();
  const exact = items.filter((item) => item.note.id.toUpperCase() === wanted);
  const matches = exact.length
    ? exact
    : items.filter((item) => item.note.id.toUpperCase().startsWith(wanted));
  const [only] = matches;
  return only && matches.length === 1 ? { ok: true, item: only } : { ok: false, matches };
}
