import { describe, expect, it } from 'vitest';
import { parseNote, readBundle, serializeNote, ulid, writeBundle } from './index.ts';
import type { Note } from './index.ts';

describe('core in a browser', () => {
  const note: Note = {
    id: ulid(),
    schema: 1,
    status: 'open',
    created: new Date().toISOString(),
    url: 'http://localhost:5173/checkout',
    screenshot: 'screenshot.png',
    body: 'Captured in a real browser 🚀\n',
  };
  const attachments = { 'screenshot.png': new Uint8Array([137, 80, 78, 71, 1, 2, 3]) };

  it('round-trips note.md', () => {
    expect(parseNote(serializeNote(note))).toEqual({ ok: true, value: note });
  });

  it('round-trips an export bundle', () => {
    expect(readBundle(writeBundle([{ note, attachments }]))).toEqual({
      ok: true,
      value: [{ note, attachments }],
    });
  });

  it('rejects hostile bundles', () => {
    expect(readBundle(new Uint8Array([1, 2, 3])).ok).toBe(false);
  });
});
