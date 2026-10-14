// `resolve`, `wontfix`, `reopen` and `prune`. Status changes rewrite only
// `status` and `resolution` in note.md, leaving the rest of the file (body,
// comments, unknown fields) as it was (spec/SPEC.md's rules for readers).
import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type NoteStatus, parseNote, updateNote } from '@field-notes/core';
import type { Item } from './notes.ts';

/** What `--note` and `--ref` make of `resolution`. */
export function resolutionOf(note: string, ref?: string): string {
  return ref ? `${note} (ref: ${ref})` : note;
}

/** Replaces `file` in one step: a reader sees the old file or the new one. */
async function writeAtomic(file: string, text: string): Promise<void> {
  // A dot first: no attachment name can start with one.
  const temp = join(file, '..', `.note.md.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, text, { flag: 'wx' });
    await rename(temp, file);
  } finally {
    await unlink(temp).catch(() => undefined);
  }
}

/**
 * Sets the note's status and resolution, reading note.md afresh. Resolves
 * false when it already had them, and leaves the file alone then.
 */
export async function setStatus(
  item: Item,
  status: NoteStatus,
  resolution: string | null,
): Promise<boolean> {
  const file = join(item.dir, 'note.md');
  const text = await readFile(file, 'utf8');
  const parsed = parseNote(text);
  if (!parsed.ok) throw parsed.error;
  const note = parsed.value;
  // Reopening a note that never had a resolution doesn't add one.
  const hasResolution = note.resolution !== undefined || resolution !== null;
  if (note.status === status && (note.resolution ?? null) === resolution) return false;
  const updated = updateNote(text, { status, ...(hasResolution ? { resolution } : {}) });
  if (!updated.ok) throw updated.error;
  await writeAtomic(file, updated.value);
  return true;
}

/** Statuses `prune` may remove: never `open`. */
export const PRUNABLE: readonly NoteStatus[] = ['resolved', 'wontfix'];

/**
 * Removes the notes with one of `statuses` whose note.md hasn't changed for
 * `age` ms, as when it was resolved. Each is read again just before it goes,
 * in case it was reopened since. Resolves with the notes removed, or that
 * would be with `dryRun`.
 */
export async function prune(
  items: readonly Item[],
  statuses: readonly NoteStatus[],
  age: number,
  now: number,
  dryRun: boolean,
): Promise<Item[]> {
  const allowed = statuses.filter((status) => PRUNABLE.includes(status));
  const removed: Item[] = [];
  for (const item of items) {
    if (!allowed.includes(item.note.status)) continue;
    const file = join(item.dir, 'note.md');
    let text;
    try {
      if (now - (await stat(file)).mtimeMs <= age) continue;
      text = await readFile(file, 'utf8');
    } catch {
      continue; // Gone since the backlog was read.
    }
    const again = parseNote(text);
    if (!again.ok || !allowed.includes(again.value.status)) continue;
    if (!dryRun) await rm(item.dir, { recursive: true, force: true });
    removed.push(item);
  }
  return removed;
}
