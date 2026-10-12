// An in-memory transport for tests: the reference implementation of the
// Transport contract, and a stand-in for the sink in outbox tests.
import { NoteSchema, isAttachmentName } from '@field-notes/core/note';
import type { StoredNote } from './transport.contract.ts';
import { type Receipt, type Transport, TransportError } from './transport.ts';

export interface FakeTransport {
  readonly transport: Transport;
  readonly stored: () => Promise<StoredNote[]>;
  /** Makes the next sends fail (`retryable` or not) until cleared. */
  failWith: TransportError | undefined;
  /** How many times it was called. */
  calls: number;
}

export function fakeTransport(): FakeTransport {
  const store = new Map<string, { entry: StoredNote; receipt: Receipt }>();
  let next = 0;
  const fake: FakeTransport = {
    failWith: undefined,
    calls: 0,
    stored: () => Promise.resolve([...store.values()].map(({ entry }) => entry)),
    transport: (note, attachments) => {
      fake.calls++;
      if (fake.failWith) return Promise.reject(fake.failWith);
      if (!NoteSchema.safeParse(note).success) {
        return Promise.reject(new TransportError('invalid note', { retryable: false }));
      }
      const bad = Object.keys(attachments).find((name) => !isAttachmentName(name));
      if (bad !== undefined) {
        return Promise.reject(
          new TransportError(`bad attachment name: ${bad}`, { retryable: false }),
        );
      }
      const existing = store.get(note.id);
      if (existing) return Promise.resolve(existing.receipt);
      const receipt = { id: `stored-${String(++next)}` };
      store.set(note.id, {
        entry: { note: structuredClone(note), attachments: { ...attachments } },
        receipt,
      });
      return Promise.resolve(receipt);
    },
  };
  return fake;
}
