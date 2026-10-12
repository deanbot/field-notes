import { ulid } from '@field-notes/core/id';
import { type Note, NoteSchema } from '@field-notes/core/note';
import { openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeTransport } from './fake-transport.ts';
import { DB_NAME, type Outbox, createOutbox } from './outbox.ts';
import type * as OutboxModule from './outbox.ts';
import { TransportError } from './transport.ts';

const controllers: AbortController[] = [];

function open(changed?: (pending: number) => void): Outbox {
  const controller = new AbortController();
  controllers.push(controller);
  return createOutbox(controller.signal, changed);
}

function note(body = 'a note', extra: Partial<Note> = {}): Note {
  return NoteSchema.parse({
    id: ulid(),
    schema: 1,
    status: 'open',
    created: new Date().toISOString(),
    body,
    ...extra,
  });
}

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => {
      resolve();
    };
    request.onerror = () => {
      reject(request.error ?? new Error('delete failed'));
    };
    // `blocked` only means a connection hasn't closed yet; the outbox closes
    // on versionchange, and the delete then goes ahead.
  });
}

beforeEach(async () => {
  localStorage.clear();
  await deleteDatabase();
});

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.abort();
  vi.restoreAllMocks();
});

describe('outbox', () => {
  it('stores notes pending, oldest first, and mirrors the count', async () => {
    const changed = vi.fn();
    const outbox = open(changed);
    const first = note('first');
    const second = note('second', { type: 'bug' });
    await outbox.add(first);
    await outbox.add(second, { 'screenshot.png': new Blob(['png']) });
    const entries = await outbox.list();
    expect(entries.map((e) => e.note.body)).toEqual(['first', 'second']);
    expect(entries.every((e) => e.state === 'pending' && e.attempts === 0)).toBe(true);
    expect(await entries[1]?.attachments['screenshot.png']?.text()).toBe('png');
    expect(changed).toHaveBeenLastCalledWith(2);
    changed.mockClear();
    expect(await outbox.pendingCount()).toBe(2);
    // A recount is reported too, so a stale badge can correct itself.
    expect(changed).toHaveBeenCalledWith(2);
  });

  it('keeps notes across a reload', async () => {
    const controller = new AbortController();
    const kept = note('survives');
    await createOutbox(controller.signal).add(kept, {
      'screenshot.png': new Blob(['png'], { type: 'image/png' }),
    });
    controller.abort();
    // A fresh module instance stands in for the reloaded page.
    const url = './outbox.ts?reload';
    const reloaded = (await import(/* @vite-ignore */ url)) as typeof OutboxModule;
    const after = new AbortController();
    controllers.push(after);
    const [entry] = await reloaded.createOutbox(after.signal).list();
    expect(entry?.id).toBe(kept.id);
    const screenshot = entry?.attachments['screenshot.png'];
    expect(screenshot?.type).toBe('image/png');
    expect(await screenshot?.text()).toBe('png');
  });

  it('refuses an invalid note or attachment name', async () => {
    const outbox = open();
    await expect(outbox.add({ ...note(), status: 'maybe' } as unknown as Note)).rejects.toThrow();
    await expect(outbox.add(note(), { '../x.png': new Blob(['x']) })).rejects.toThrow(
      'bad attachment name',
    );
    expect(await outbox.list()).toEqual([]);
  });

  it('refuses a second note with the same id', async () => {
    const outbox = open();
    const once = note();
    await outbox.add(once);
    await expect(outbox.add(once)).rejects.toThrow();
    expect(await outbox.list()).toHaveLength(1);
  });

  it('rejects when IndexedDB is unavailable', async () => {
    vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    await expect(open().add(note())).rejects.toThrow('blocked');
  });

  it('closes its connection on unmount', async () => {
    const closed = vi.spyOn(IDBDatabase.prototype, 'close');
    const controller = new AbortController();
    const outbox = createOutbox(controller.signal);
    await outbox.add(note());
    expect(closed).not.toHaveBeenCalled();
    controller.abort();
    await vi.waitFor(() => {
      expect(closed).toHaveBeenCalledOnce();
    });
    await expect(outbox.list()).rejects.toThrow('unmounted');
  });

  it('closes when another copy deletes or upgrades the database', async () => {
    const closed = vi.spyOn(IDBDatabase.prototype, 'close');
    const outbox = open();
    await outbox.add(note());
    await deleteDatabase();
    expect(closed).toHaveBeenCalled();
    // And reopens on next use.
    expect(await outbox.list()).toEqual([]);
  });

  it('steps aside for a newer database version from another copy', async () => {
    const outbox = open();
    await outbox.add(note());
    const newer = await openDB(DB_NAME, 2, {
      upgrade(database) {
        database.createObjectStore('later');
      },
    });
    expect(newer.objectStoreNames.contains('later')).toBe(true);
    newer.close();
  });
});

describe('outbox edits', () => {
  it('changes a pending note, keeping its id and created time', async () => {
    const outbox = open();
    const original = note('typo', { type: 'bug' });
    await outbox.add(original);
    const edited = await outbox.edit(original.id, { body: 'fixed', type: 'idea' });
    expect(edited.note).toMatchObject({
      id: original.id,
      created: original.created,
      body: 'fixed',
      type: 'idea',
    });
    const cleared = await outbox.edit(original.id, { body: 'fixed' });
    expect(cleared.note).not.toHaveProperty('type');
    expect((await outbox.list())[0]?.note.body).toBe('fixed');
  });

  it('refuses to edit a delivered or missing note', async () => {
    const outbox = open();
    const sent = note();
    await outbox.add(sent);
    await outbox.flush(fakeTransport().transport);
    await expect(outbox.edit(sent.id, { body: 'late' })).rejects.toThrow('already delivered');
    await expect(outbox.edit('nope', { body: 'x' })).rejects.toThrow('not found');
  });

  it('refuses an edit the schema rejects', async () => {
    const outbox = open();
    const original = note();
    await outbox.add(original);
    await expect(outbox.edit(original.id, { body: 'x', type: '' })).resolves.toBeTruthy();
    await expect(outbox.edit(original.id, { body: 1 as unknown as string })).rejects.toThrow();
  });

  it('removes a note and updates the count', async () => {
    const changed = vi.fn();
    const outbox = open(changed);
    const gone = note();
    await outbox.add(gone);
    await outbox.remove(gone.id);
    expect(await outbox.list()).toEqual([]);
    expect(changed).toHaveBeenLastCalledWith(0);
  });
});

describe('outbox flush', () => {
  it('delivers pending notes in order and records receipts', async () => {
    const fake = fakeTransport();
    const changed = vi.fn();
    const outbox = open(changed);
    await outbox.add(note('one'));
    await outbox.add(note('two'));
    expect(await outbox.flush(fake.transport)).toEqual({
      delivered: 2,
      rejected: 0,
      stopped: false,
    });
    const entries = await outbox.list();
    expect(entries.map((e) => e.state)).toEqual(['delivered', 'delivered']);
    expect(entries[0]?.receipt).toEqual({ id: 'stored-1' });
    expect((await fake.stored()).map((s) => s.note.body)).toEqual(['one', 'two']);
    expect(changed).toHaveBeenLastCalledWith(0);
    expect(await outbox.flush(fake.transport)).toEqual({
      delivered: 0,
      rejected: 0,
      stopped: false,
    });
    expect(fake.calls).toBe(2);
  });

  it('stops at a retryable failure, keeping order', async () => {
    const fake = fakeTransport();
    fake.failWith = new TransportError('sink down', { retryable: true });
    const outbox = open();
    await outbox.add(note('one'));
    await outbox.add(note('two'));
    expect(await outbox.flush(fake.transport)).toEqual({
      delivered: 0,
      rejected: 0,
      stopped: true,
    });
    expect(fake.calls).toBe(1);
    const [first] = await outbox.list();
    expect(first).toMatchObject({ state: 'pending', attempts: 1, lastError: 'sink down' });
    fake.failWith = undefined;
    expect(await outbox.flush(fake.transport)).toMatchObject({ delivered: 2 });
  });

  it('treats an unknown error as retryable', async () => {
    const outbox = open();
    await outbox.add(note());
    const result = await outbox.flush(() => Promise.reject(new Error('network')));
    expect(result.stopped).toBe(true);
  });

  it('skips a note rejected for good, so it cannot block the queue', async () => {
    const fake = fakeTransport();
    const outbox = open();
    const bad = note('bad');
    await outbox.add(bad);
    await outbox.add(note('good'));
    let first = true;
    const picky = (
      n: Note,
      a: Parameters<typeof fake.transport>[1],
    ): ReturnType<typeof fake.transport> => {
      if (n.id === bad.id && first) {
        first = false;
        return Promise.reject(new TransportError('rejected by the sink', { retryable: false }));
      }
      return fake.transport(n, a);
    };
    expect(await outbox.flush(picky)).toEqual({ delivered: 1, rejected: 1, stopped: false });
    const entries = await outbox.list();
    expect(entries[0]).toMatchObject({
      state: 'pending',
      rejected: true,
      lastError: 'rejected by the sink',
    });
    expect(await outbox.flush(picky)).toEqual({ delivered: 0, rejected: 0, stopped: false });
  });

  it('leaves a note removed while it was being sent', async () => {
    const outbox = open();
    const racing = note();
    await outbox.add(racing);
    const result = await outbox.flush(async (n) => {
      await outbox.remove(n.id);
      return { id: 'r' };
    });
    expect(result.delivered).toBe(1);
    expect(await outbox.list()).toEqual([]);
  });
});
