// The extension seam: a transport takes a note from the outbox somewhere.
// v1 has `local` (the sink, #13) and `export` (a zip, #15); later adapters
// (http, collector, trackers) implement the same type and pass the same
// contract suite (transport.contract.ts).
import type { Note } from '@field-notes/core/note';

/** Files sent with a note, by attachment name (see `isAttachmentName`). */
export type Attachments = Readonly<Record<string, Blob>>;

/** What a transport hands back once a note is safely stored. */
export interface Receipt {
  /** The id the note is stored under on the other side; may differ from `note.id`. */
  readonly id: string;
  readonly [key: string]: unknown;
}

/**
 * Stores one note and its attachments. Resolves once it's stored. Sending the
 * same `note.id` again must not store it twice: it resolves with the same
 * receipt. Rejects with a `TransportError`.
 */
export type Transport = (note: Note, attachments: Attachments) => Promise<Receipt>;

/**
 * Why a send failed. `retryable` says whether the same note may succeed
 * later (the sink is down) or never will (the note or an attachment was
 * rejected).
 */
export class TransportError extends Error {
  readonly retryable: boolean;

  constructor(message: string, options: { retryable: boolean; cause?: unknown }) {
    super(message, { cause: options.cause });
    this.name = 'TransportError';
    this.retryable = options.retryable;
  }
}
