// Export mode's author: asked for once in the panel and kept in this
// viewer's localStorage, as nothing else fills it in (in local mode the sink
// has `git config user.name`). Storage can be missing, full or blocked; then
// the name just isn't remembered.

import type { FieldNotesOptions } from './mount.ts';

const KEY = 'field-notes:author';

/** The longest name kept. */
export const MAX_AUTHOR = 100;

/** Trimmed and capped; undefined if blank. */
export function cleanAuthor(name: string): string | undefined {
  return name.trim().slice(0, MAX_AUTHOR).trim() || undefined;
}

export function loadAuthor(): string | undefined {
  try {
    const name = localStorage.getItem(KEY);
    return name === null ? undefined : cleanAuthor(name);
  } catch {
    return undefined;
  }
}

/** Remembers the name, or forgets it if blank. */
export function saveAuthor(name: string): void {
  try {
    const clean = cleanAuthor(name);
    if (clean) localStorage.setItem(KEY, clean);
    else localStorage.removeItem(KEY);
  } catch {
    // Not remembered; it's asked for again.
  }
}

/** Whether the panel asks for a name: export mode, with no `author` option. */
export function asksAuthor(options: FieldNotesOptions): boolean {
  return options.mode === 'export' && options.author === undefined;
}
