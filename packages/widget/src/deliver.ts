import type { Note } from '@field-notes/core/note';

/**
 * Where a submitted note goes. Resolves once the note is safely stored.
 * A placeholder that accepts and drops it, until the outbox (#11) takes over.
 */
export function deliver(_note: Note): Promise<void> {
  return Promise.resolve();
}
