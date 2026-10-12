// The shared Transport contract. Every transport (fake, local, export, and
// later adapters) runs it from its own test file:
//
//   transportContract('local', async () => ({ transport, stored, cleanup }));
//
// It checks only what's observable through the transport and its own idea
// of "stored", so it fits transports that send nothing anywhere (export).
import { type Note, NoteSchema } from '@field-notes/core/note';
import { ulid } from '@field-notes/core/id';
import { afterEach, describe, expect, it } from 'vitest';
import { type Attachments, type Transport, TransportError } from './transport.ts';

export interface StoredNote {
  readonly note: Note;
  readonly attachments: Attachments;
}

export interface ContractSubject {
  readonly transport: Transport;
  /** What the transport has stored so far, however it stores it. */
  readonly stored: () => Promise<StoredNote[]>;
  readonly cleanup?: (() => Promise<void>) | undefined;
}

function sampleNote(body = 'The total is wrong'): Note {
  return NoteSchema.parse({
    id: ulid(),
    schema: 1,
    status: 'open',
    created: new Date().toISOString(),
    type: 'bug',
    url: 'http://localhost:5173/checkout',
    viewport: { width: 1440, height: 900, dpr: 2 },
    context: { appVersion: '1.4.0' },
    body,
  });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !(value instanceof Blob)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const text = (blob: Blob | undefined): Promise<string> =>
  blob ? blob.text() : Promise.reject(new Error('missing attachment'));

export function transportContract(name: string, setup: () => Promise<ContractSubject>): void {
  describe(`Transport contract: ${name}`, () => {
    let subject: ContractSubject | undefined;
    const start = async (): Promise<ContractSubject> => {
      subject = await setup();
      return subject;
    };

    afterEach(async () => {
      await subject?.cleanup?.();
      subject = undefined;
    });

    it('stores a note and resolves with a receipt', async () => {
      const { transport, stored } = await start();
      const note = sampleNote();
      const receipt = await transport(note, {});
      expect(typeof receipt.id).toBe('string');
      expect(receipt.id).not.toBe('');
      const all = await stored();
      expect(all).toHaveLength(1);
      expect(all[0]?.note).toMatchObject({ ...note, id: expect.any(String) as string });
    });

    it('stores attachments under their names', async () => {
      const { transport, stored } = await start();
      const note = { ...sampleNote(), screenshot: 'screenshot.png' };
      await transport(note, { 'screenshot.png': new Blob(['png bytes'], { type: 'image/png' }) });
      const [entry] = await stored();
      expect(await text(entry?.attachments['screenshot.png'])).toBe('png bytes');
    });

    it("doesn't change what it's given", async () => {
      const { transport } = await start();
      const note = sampleNote();
      const copy = structuredClone(note);
      const attachments = { 'a.txt': new Blob(['a']) };
      await transport(deepFreeze(note), deepFreeze(attachments));
      expect(note).toEqual(copy);
      expect(Object.keys(attachments)).toEqual(['a.txt']);
    });

    it('stores a resent note once, with the same receipt', async () => {
      const { transport, stored } = await start();
      const note = sampleNote();
      const first = await transport(note, {});
      const second = await transport(note, {});
      expect(second.id).toBe(first.id);
      expect(await stored()).toHaveLength(1);
    });

    it('stores concurrent sends of different notes', async () => {
      const { transport, stored } = await start();
      const notes = Array.from({ length: 5 }, (_, i) => sampleNote(`note ${String(i)}`));
      const receipts = await Promise.all(notes.map((note) => transport(note, {})));
      expect(new Set(receipts.map((r) => r.id)).size).toBe(5);
      const bodies = (await stored()).map((entry) => entry.note.body).sort();
      expect(bodies).toEqual(notes.map((note) => note.body).sort());
    });

    it('rejects a bad attachment name for good', async () => {
      const { transport, stored } = await start();
      const error: unknown = await transport(sampleNote(), {
        '../evil.png': new Blob(['x']),
      }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(TransportError);
      expect((error as TransportError).retryable).toBe(false);
      expect(await stored()).toHaveLength(0);
    });

    it('rejects an invalid note for good', async () => {
      const { transport, stored } = await start();
      const bad = { ...sampleNote(), status: 'maybe' } as unknown as Note;
      const error: unknown = await transport(bad, {}).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(TransportError);
      expect((error as TransportError).retryable).toBe(false);
      expect(await stored()).toHaveLength(0);
    });
  });
}
