// `field-notes import`: an export zip's notes into `.field-notes/items/`,
// written the way the sink writes them, so nothing tells the two apart.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { type BundleError, noteDirName, parseNote, readBundle } from '@field-notes/core';
import { DEFAULT_GITIGNORE, hasCode, setUpSinkDir, writeNoteDir } from './store.ts';

/** The largest zip it reads, and the most its notes may unpack to. */
export const MAX_IMPORT_BYTES: number = 256 * 2 ** 20;

export interface ImportResult {
  /** Directories written, relative to the notes directory (`items/<id>-<slug>`). */
  readonly imported: readonly string[];
  /** Ids already in the notes directory (or earlier in the zip): left as they are. */
  readonly skipped: readonly string[];
  /** Notes whose directory name is taken by another note: not imported. */
  readonly conflicts: readonly { readonly id: string; readonly dir: string }[];
}

export type ImportOutcome =
  | { readonly ok: true; readonly value: ImportResult }
  | { readonly ok: false; readonly error: BundleError };

/** Ids of the notes in `items`. Directories without a valid `note.md` don't count. */
async function existingIds(items: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const name of await readdir(items)) {
    let text: string;
    try {
      text = await readFile(join(items, name, 'note.md'), 'utf8');
    } catch {
      continue; // Still being written, or not a note.
    }
    const parsed = parseNote(text);
    if (parsed.ok) ids.add(parsed.value.id);
  }
  return ids;
}

/**
 * Imports the notes in an export zip into `dir`. The whole zip is checked
 * first: a hostile or broken one writes nothing. A note whose id is already
 * there is skipped, so importing the same zip again changes nothing.
 */
export async function importBundle(
  dir: string,
  zip: Uint8Array,
  gitignore: string | false = DEFAULT_GITIGNORE,
): Promise<ImportOutcome> {
  const read = readBundle(zip, { maxTotalSize: MAX_IMPORT_BYTES });
  if (!read.ok) return read;
  await setUpSinkDir(dir, gitignore);
  const items = join(dir, 'items');
  const known = await existingIds(items);
  const imported: string[] = [];
  const skipped: string[] = [];
  const conflicts: { id: string; dir: string }[] = [];
  for (const { note, attachments } of read.value) {
    if (known.has(note.id)) {
      skipped.push(note.id);
      continue;
    }
    known.add(note.id);
    try {
      imported.push(`items/${await writeNoteDir(items, note, Object.entries(attachments))}`);
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) throw error;
      conflicts.push({ id: note.id, dir: `items/${noteDirName(note)}` });
    }
  }
  return { ok: true, value: { imported, skipped, conflicts } };
}
