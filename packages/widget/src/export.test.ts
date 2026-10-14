// Export mode end to end: submit → outbox → "My notes" → Export → a zip that
// core's readBundle accepts. Nothing goes over the network.
import { readBundle } from '@field-notes/core';
import axe from 'axe-core';
import { userEvent } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TAG_NAME } from './element.ts';
import { createExportTransport, exportFileName } from './export.ts';
import { mountFieldNotes } from './index.ts';
import {
  type FieldNotesHandle,
  type FieldNotesOptions,
  mountFieldNotes as mountWithout,
} from './mount.ts';
import { createOutbox } from './outbox.ts';
import { transportContract } from './transport.contract.ts';
import { resetDatabase } from './test-outbox.ts';

transportContract('export', () => {
  const held = createExportTransport();
  return Promise.resolve({
    transport: held.transport,
    stored: () => Promise.resolve(held.stored()),
  });
});

let handle: FieldNotesHandle | undefined;
const controllers: AbortController[] = [];
let downloads: { name: string; bytes: Uint8Array }[] = [];
let fetches: string[] = [];

beforeEach(async () => {
  localStorage.clear();
  await resetDatabase();
  downloads = [];
  fetches = [];
  // Downloads are caught at the link: the blob it points to is the zip.
  const blobs = new Map<string, Blob>();
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    const url = `blob:test/${String(blobs.size)}`;
    blobs.set(url, blob as Blob);
    return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    const blob = blobs.get(this.href);
    if (!blob) throw new Error(`no blob at ${this.href}`);
    void blob.arrayBuffer().then((buffer) => {
      downloads.push({ name: this.download, bytes: new Uint8Array(buffer) });
    });
  });
  const real = window.fetch.bind(window);
  vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
    fetches.push(input instanceof Request ? input.url : String(input));
    return real(input, init);
  });
});

afterEach(() => {
  handle?.unmount();
  handle = undefined;
  for (const controller of controllers.splice(0)) controller.abort();
  localStorage.clear();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const shadow = (): ShadowRoot => {
  const root = document.querySelector(TAG_NAME)?.shadowRoot;
  if (!root) throw new Error('not mounted');
  return root;
};
const query = (selector: string): HTMLElement | null => shadow().querySelector(selector);
const badge = (): string => query('.trigger .badge')?.textContent ?? '';
const text = (selector: string): string =>
  query(selector)?.textContent.replace(/\s+/g, ' ').trim() ?? '';
/** The panel's button whose text starts with `label`, if shown. */
const button = (label: string): HTMLButtonElement | undefined =>
  [...shadow().querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(label));

function mount(options: FieldNotesOptions = {}): FieldNotesHandle {
  handle = mountFieldNotes({ enabled: true, screenshot: 'off', mode: 'export', ...options });
  return handle;
}

async function submit(body: string): Promise<void> {
  await handle?.open();
  const textarea = query('#field-notes-text');
  if (!textarea) throw new Error('no textarea');
  await userEvent.type(textarea, body);
  await userEvent.keyboard('{Control>}{Enter}{/Control}');
  await vi.waitFor(() => {
    expect(query('dialog')).toBeNull();
  });
}

async function openNotes(): Promise<void> {
  await handle?.open();
  query('#field-notes-mode')?.click();
  await vi.waitFor(() => {
    expect(button('Export')).toBeDefined();
  });
}

async function exportAll(): Promise<{ name: string; bytes: Uint8Array }> {
  const before = downloads.length;
  button('Export')?.click();
  await vi.waitFor(() => {
    expect(downloads).toHaveLength(before + 1);
  });
  const latest = downloads.at(-1);
  if (!latest) throw new Error('no download');
  return latest;
}

const bodiesIn = (zip: Uint8Array): string[] => {
  const read = readBundle(zip);
  if (!read.ok) throw read.error;
  return read.value.map((item) => item.note.body).sort();
};

describe('export mode', () => {
  it('logs 3, counts 3, exports a zip of the 3 with index.md, then counts 0', async () => {
    mount();
    for (const body of ['one', 'two', 'three']) await submit(body);
    await vi.waitFor(() => {
      expect(badge()).toBe('3');
    });
    await handle?.open();
    expect(text('#field-notes-mode')).toBe('My notes (3 not exported)');
    await openNotes();
    expect(text('.notes')).toContain('3 notes not yet exported, stored only in this browser.');
    expect(text('.entry .meta')).toContain('Not exported yet');

    const { name, bytes } = await exportAll();
    expect(name).toMatch(/^field-notes-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/);
    expect(bodiesIn(bytes)).toEqual(['one', 'three', 'two']);
    // Entry names are plain text in a zip's directory.
    expect(new TextDecoder().decode(bytes)).toContain('index.md');
    // The ids are the browser's own.
    const read = readBundle(bytes);
    const ids = (await outboxView().list()).map((entry) => entry.id).sort();
    expect(read.ok && read.value.map((item) => item.note.id).sort()).toEqual(ids);

    await vi.waitFor(() => {
      expect(badge()).toBe('');
    });
    await vi.waitFor(() => {
      expect(button('Export')?.textContent.trim()).toBe('Export (0)');
    });
    expect(button('Export')?.disabled).toBe(true);
    expect(text('.entry .meta')).toContain('Exported');
    expect(fetches).toEqual([]);
  });

  it('downloads the same zip again until the next export, which replaces it', async () => {
    mount();
    await submit('first');
    await openNotes();
    const first = await exportAll();
    await vi.waitFor(() => {
      expect(button('Download last export again')).toBeDefined();
    });
    button('Download last export again')?.click();
    await vi.waitFor(() => {
      expect(downloads).toHaveLength(2);
    });
    expect(downloads[1]?.name).toBe(first.name);
    expect(downloads[1]?.bytes).toEqual(first.bytes);

    handle?.close();
    await submit('second');
    await openNotes();
    const second = await exportAll();
    expect(bodiesIn(second.bytes)).toEqual(['second']);
    expect((await outboxView().list()).map((entry) => entry.note.body)).toEqual(['second']);
    await vi.waitFor(() => {
      expect(button('Download last export again')?.disabled).toBe(false);
    });
    button('Download last export again')?.click();
    await vi.waitFor(() => {
      expect(downloads).toHaveLength(4);
    });
    expect(downloads[3]?.bytes).toEqual(second.bytes);
  });

  it('offers the last export for 7 days, then stops and forgets it', async () => {
    mount();
    await submit('kept a week');
    await openNotes();
    await exportAll();
    await vi.waitFor(() => {
      expect(button('Download last export again')).toBeDefined();
    });
    handle?.close();
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 6 * 86_400_000);
    await openNotes();
    expect(button('Download last export again')).toBeDefined();
    handle?.close();
    clock.mockReturnValue(now + 7 * 86_400_000 + 1000);
    await openNotes();
    expect(button('Download last export again')).toBeUndefined();
    expect(await outboxView().list()).toEqual([]);
  });

  it('keeps the last export for exportRetentionDays', async () => {
    mount({ exportRetentionDays: 1 });
    await submit('kept a day');
    await openNotes();
    await exportAll();
    handle?.close();
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 86_400_000 + 1000);
    await openNotes();
    expect(button('Download last export again')).toBeUndefined();
    expect(await outboxView().list()).toEqual([]);
  });

  it('suggests an export once the unexported notes reach the threshold', async () => {
    mount({ storageWarning: { notes: 2 } });
    await submit('one');
    await openNotes();
    expect(query('.warning')).toBeNull();
    handle?.close();
    await submit('two');
    await openNotes();
    expect(text('.warning')).toContain('Export soon');
  });

  it('suggests an export once the unexported notes reach the size threshold', async () => {
    mount({ storageWarning: { megabytes: 0.000001 } });
    await submit('a few bytes');
    await openNotes();
    expect(text('.warning')).toContain('Export soon');
  });

  it("sends nothing for notes from an earlier visit, and doesn't load delivery", async () => {
    await outboxView().add({
      id: '01J0000000000000000000000C',
      schema: 1,
      status: 'open',
      created: new Date().toISOString(),
      body: 'left over',
    });
    localStorage.setItem('field-notes:pending', '1');
    mount();
    await vi.waitFor(() => {
      expect(badge()).toBe('1');
    });
    await new Promise((done) => setTimeout(done, 300));
    expect(fetches).toEqual([]);
  });

  it('says it failed, and keeps the notes, where the build has no export (script tag)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    handle = mountWithout({ enabled: true, mode: 'export' });
    await submit('stuck');
    await openNotes();
    button('Export')?.click();
    await vi.waitFor(() => {
      expect(text('.error')).toBe("Couldn't export your notes.");
    });
    expect(warn).toHaveBeenCalled();
    expect(downloads).toEqual([]);
    expect((await outboxView().list())[0]?.state).toBe('pending');
  });
});

describe('the export file name', () => {
  it('is field-notes-<YYYY-MM-DD-HHmm>.zip in local time', () => {
    expect(exportFileName(new Date(2026, 0, 5, 7, 3))).toBe('field-notes-2026-01-05-0703.zip');
  });
});

/** A view of the outbox, as the tests' window into IndexedDB. */
function outboxView(): ReturnType<typeof createOutbox> {
  const controller = new AbortController();
  controllers.push(controller);
  return createOutbox(controller.signal);
}

describe('the author', () => {
  const nameField = (): HTMLInputElement | null =>
    shadow().querySelector<HTMLInputElement>('#field-notes-author');
  /** Submits a note, typing `name` in the name field first if given. */
  async function submitAs(body: string, name?: string): Promise<void> {
    await handle?.open();
    if (name !== undefined) {
      const field = nameField();
      if (!field) throw new Error('no name field');
      await userEvent.type(field, name);
    }
    await submit(body);
  }
  /** Each note's author, oldest first. */
  const authors = async (): Promise<(string | undefined)[]> =>
    (await outboxView().list()).map((entry) => entry.note.author);
  async function openFormWith(field: boolean): Promise<void> {
    await handle?.open();
    await vi.waitFor(() => {
      expect(query('#field-notes-text')).not.toBeNull();
    });
    expect(nameField() !== null).toBe(field);
    handle?.close();
  }

  it('is asked for on the first note, then remembered, across a reload, and exported', async () => {
    mount();
    await openFormWith(true);
    await submitAs('first', '  Ada Lovelace  ');
    await openFormWith(false);
    await submit('second');
    handle?.unmount();
    mount();
    await openFormWith(false);
    await submit('after a reload');
    expect(await authors()).toEqual(['Ada Lovelace', 'Ada Lovelace', 'Ada Lovelace']);
    await openNotes();
    expect(text('.signed')).toBe('Signed as Ada Lovelace');
    const read = readBundle((await exportAll()).bytes);
    if (!read.ok) throw read.error;
    expect(read.value.map((item) => item.note.author)).toEqual([
      'Ada Lovelace',
      'Ada Lovelace',
      'Ada Lovelace',
    ]);
  });

  it("is optional: a note goes without one, the next one doesn't ask, and My notes adds it", async () => {
    mount();
    await submitAs('anonymous');
    await openFormWith(false);
    await submit('still anonymous');
    await openNotes();
    expect(text('.signed')).toBe('Not signed');
    button('Add your name')?.click();
    const field = await vi.waitFor(() => {
      const found = shadow().querySelector<HTMLInputElement>('#field-notes-rename');
      if (!found) throw new Error('no rename field');
      return found;
    });
    await userEvent.type(field, 'Ada');
    button('Save name')?.click();
    await vi.waitFor(() => {
      expect(text('.signed')).toBe('Signed as Ada');
    });
    handle?.close();
    await submit('signed');
    expect(await authors()).toEqual([undefined, undefined, 'Ada']);
  });

  it('is changed in My notes for new notes only, and asked for again once cleared there', async () => {
    mount();
    await submitAs('before', 'Ada');
    await openNotes();
    button('Change name')?.click();
    const field = await vi.waitFor(() => {
      const found = shadow().querySelector<HTMLInputElement>('#field-notes-rename');
      if (!found) throw new Error('no rename field');
      return found;
    });
    expect(field.value).toBe('Ada');
    await userEvent.clear(field);
    await userEvent.type(field, 'Grace');
    button('Save name')?.click();
    await vi.waitFor(() => {
      expect(text('.signed')).toBe('Signed as Grace');
    });
    handle?.close();
    await submit('after');
    expect(await authors()).toEqual(['Ada', 'Grace']);
    await openNotes();
    button('Change name')?.click();
    await vi.waitFor(() => {
      expect(shadow().querySelector('#field-notes-rename')).not.toBeNull();
    });
    const rename = shadow().querySelector<HTMLInputElement>('#field-notes-rename');
    if (!rename) throw new Error('no rename field');
    await userEvent.clear(rename);
    button('Save name')?.click();
    await vi.waitFor(() => {
      expect(text('.signed')).toBe('Not signed');
    });
    expect(button('Add your name')).toBeDefined();
    handle?.close();
    await openFormWith(true);
  });

  it.each([
    ['a string', 'Host name', 'Host name'],
    ['a function', () => 'From a function', 'From a function'],
    [
      'a function that throws',
      () => {
        throw new Error('no user');
      },
      undefined,
    ],
  ])('is never asked for when the host gives one: %s', async (_, author, expected) => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    localStorage.setItem('field-notes:author', 'Remembered');
    mount({ author });
    await openFormWith(false);
    await submit('note');
    expect(await authors()).toEqual([expected]);
    await openNotes();
    expect(query('.signed')).toBeNull();
    expect(button('Change name')).toBeUndefined();
  });

  it("isn't asked for, or taken from this browser, in local mode", async () => {
    localStorage.setItem('field-notes:author', 'Remembered');
    handle = mountFieldNotes({ enabled: true, screenshot: 'off' });
    await openFormWith(false);
    await submit('local');
    expect(await authors()).toEqual([undefined]);
  });

  it.each([
    [
      'its methods throw',
      () => {
        for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
          vi.spyOn(Storage.prototype, method).mockImplementation(() => {
            throw new DOMException('blocked', 'SecurityError');
          });
        }
      },
    ],
    [
      "it can't be reached",
      () => {
        vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
          throw new DOMException('blocked', 'SecurityError');
        });
      },
    ],
  ])(
    "doesn't stop a note when storage fails (%s): what's typed signs that note only, and the next asks again",
    async (_, block) => {
      block();
      mount();
      await submitAs('typed', 'Ada');
      await submitAs('not typed');
      await openFormWith(true);
      vi.restoreAllMocks();
      expect(await authors()).toEqual(['Ada', undefined]);
    },
  );

  it('is asked for accessibly', async () => {
    mount();
    await openFormWith(true);
    await handle?.open();
    const results = await axe.run(shadow().host);
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
