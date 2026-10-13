import type { Note } from '@field-notes/core/note';
import type { Outbox } from './outbox.ts';
import type { Attachments } from './transport.ts';

/**
 * Where a submitted note goes: the outbox, which survives reloads. Resolves
 * once the note is stored there; a transport delivers it from there.
 */
export function deliver(note: Note, outbox: Outbox, attachments?: Attachments): Promise<void> {
  return outbox.add(note, attachments);
}
