// The outbox end to end, unmocked: submit → IndexedDB → badge → drawer.
import axe from 'axe-core';
import { userEvent } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TAG_NAME } from './element.ts';
import { fakeTransport } from './fake-transport.ts';
import { type FieldNotesHandle, type FieldNotesOptions, mountFieldNotes } from './mount.ts';
import { type Outbox, createOutbox } from './outbox.ts';
import { PENDING_KEY } from './pending.ts';
import { resetDatabase } from './test-outbox.ts';

let handle: FieldNotesHandle | undefined;
const controllers: AbortController[] = [];

// No screenshots: they're tested in screenshot.test.ts, and here they'd only
// add timing to every submit.
function mount(options: FieldNotesOptions = {}): FieldNotesHandle {
  handle = mountFieldNotes({ enabled: true, screenshot: 'off', ...options });
  return handle;
}

/** A second view of the same outbox, as the tests' window into IndexedDB. */
function outbox(): Outbox {
  const controller = new AbortController();
  controllers.push(controller);
  return createOutbox(controller.signal);
}

beforeEach(async () => {
  localStorage.clear();
  await resetDatabase();
});

afterEach(() => {
  handle?.unmount();
  for (const controller of controllers.splice(0)) controller.abort();
  localStorage.clear();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function shadow(): ShadowRoot {
  const root = document.querySelector(TAG_NAME)?.shadowRoot;
  if (!root) throw new Error('not mounted');
  return root;
}
const query = (selector: string): HTMLElement | null => shadow().querySelector(selector);
/** The element, which the test needs to be there. */
function el(selector: string): HTMLElement {
  const found = query(selector);
  if (!found) throw new Error(`no ${selector}`);
  return found;
}
function textarea(): HTMLTextAreaElement {
  const found = shadow().querySelector<HTMLTextAreaElement>('#field-notes-text');
  if (!found) throw new Error('no textarea');
  return found;
}
const badge = (): string => query('.trigger .badge')?.textContent ?? '';
const modeButton = (): HTMLButtonElement | null =>
  shadow().querySelector<HTMLButtonElement>('#field-notes-mode');
const summaries = (): string[] =>
  [...shadow().querySelectorAll('.entry .summary')].map((el) => el.textContent);

async function submit(text: string): Promise<void> {
  await handle?.open();
  await userEvent.type(textarea(), text);
  await userEvent.keyboard('{Control>}{Enter}{/Control}');
  await vi.waitFor(() => {
    expect(query('dialog')).toBeNull();
  });
}

async function openNotes(): Promise<void> {
  await handle?.open();
  // The panel recounts pending notes on open and relabels this button; wait
  // for that, since userEvent finds the button by its label.
  const expected = (await outbox().pendingCount()) ? /not sent/ : /^My notes$/;
  await vi.waitFor(() => {
    expect(modeButton()?.textContent.trim()).toMatch(expected);
  });
  const toggle = modeButton();
  if (!toggle) throw new Error('no My notes button');
  await userEvent.click(toggle);
  await vi.waitFor(() => {
    expect(query('.notes .meta')?.textContent).not.toBe('Loading…');
  });
}

describe('submitting', () => {
  it('stores the note in the outbox and shows it on the badge', async () => {
    mount();
    expect(badge()).toBe('');
    await submit('The total is wrong');
    const entries = await outbox().list();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ state: 'pending', note: { body: 'The total is wrong' } });
    await vi.waitFor(() => {
      expect(badge()).toBe('1');
    });
    expect(query('.trigger')?.getAttribute('aria-label')).toBe('Field notes, 1 pending');
  });

  it('keeps notes across a remount, and shows the badge at mount without IndexedDB', async () => {
    mount();
    await submit('kept');
    handle?.unmount();
    const open = vi.spyOn(indexedDB, 'open');
    mount();
    expect(badge()).toBe('1');
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
    await openNotes();
    expect(summaries()).toEqual(['kept']);
  });

  it('keeps the draft and shows an error when IndexedDB is unavailable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    mount();
    await handle?.open();
    await userEvent.type(textarea(), 'not lost');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await vi.waitFor(() => {
      expect(query('.error')?.textContent).toContain("Couldn't add the note");
    });
    expect(textarea().value).toBe('not lost');
    expect(JSON.parse(localStorage.getItem('field-notes:draft') ?? '{}')).toMatchObject({
      text: 'not lost',
    });
  });
});

describe('the badge', () => {
  it('follows other tabs through storage events', () => {
    mount();
    localStorage.setItem(PENDING_KEY, '4');
    window.dispatchEvent(new StorageEvent('storage', { key: PENDING_KEY, newValue: '4' }));
    expect(badge()).toBe('4');
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }));
    localStorage.removeItem(PENDING_KEY);
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }));
    expect(badge()).toBe('4');
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(badge()).toBe('');
  });

  it('corrects a stale count when the panel opens', async () => {
    await outbox().add({
      id: '01J0000000000000000000000A',
      schema: 1,
      status: 'open',
      created: new Date().toISOString(),
      body: 'one',
    });
    localStorage.setItem(PENDING_KEY, '9');
    mount();
    expect(badge()).toBe('9');
    await handle?.open();
    await vi.waitFor(() => {
      expect(badge()).toBe('1');
    });
  });

  it('appears in the panel header when there is no button', async () => {
    mount({ trigger: ['hotkey'] });
    await submit('one');
    await handle?.open();
    await vi.waitFor(() => {
      expect(modeButton()?.textContent.trim()).toBe('My notes (1 not sent)');
    });
  });
});

describe('My notes', () => {
  it('lists notes newest first', async () => {
    mount();
    await submit('first');
    await submit('second');
    await openNotes();
    expect(summaries()).toEqual(['second', 'first']);
  });

  it('edits a pending note in the outbox', async () => {
    mount();
    await submit('typo');
    await openNotes();
    await userEvent.click(el('.entry button.link'));
    const edit = el('#field-notes-edit');
    await userEvent.clear(edit);
    await userEvent.type(edit, 'fixed');
    await userEvent.selectOptions(el('#field-notes-edit-type'), 'idea');
    await userEvent.click(el('.entry button.primary'));
    await vi.waitFor(() => {
      expect(summaries()).toEqual(['fixed']);
    });
    const [entry] = await outbox().list();
    expect(entry?.note).toMatchObject({ body: 'fixed', type: 'idea' });
  });

  it('refuses to save an empty edit', async () => {
    mount();
    await submit('keep');
    await openNotes();
    await userEvent.click(el('.entry button.link'));
    await userEvent.clear(el('#field-notes-edit'));
    await userEvent.click(el('.entry button.primary'));
    expect(query('.notes .error')?.textContent).toBe('A note needs some text.');
    expect((await outbox().list())[0]?.note.body).toBe('keep');
  });

  it('says the edit failed when another tab delivered the note meanwhile', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mount();
    await submit('raced');
    await openNotes();
    await userEvent.click(el('.entry button.link'));
    await userEvent.type(el('#field-notes-edit'), ' late');
    await outbox().flush(fakeTransport().transport);
    await userEvent.click(el('.entry button.primary'));
    await vi.waitFor(() => {
      expect(query('.notes .error')?.textContent).toBe("Couldn't save the change.");
    });
    // The edit stays open, so the text isn't lost.
    expect((el('#field-notes-edit') as HTMLTextAreaElement).value).toBe('raced late');
    expect(warn).toHaveBeenCalled();
  });

  it('cancels an edit', async () => {
    mount();
    await submit('as is');
    await openNotes();
    await userEvent.click(el('.entry button.link'));
    await userEvent.type(el('#field-notes-edit'), ' changed');
    const cancel = [...shadow().querySelectorAll<HTMLButtonElement>('.entry button.link')].find(
      (b) => b.textContent.trim() === 'Cancel',
    );
    if (!cancel) throw new Error('no cancel');
    await userEvent.click(cancel);
    expect(summaries()).toEqual(['as is']);
  });

  it('deletes a pending note and updates the badge', async () => {
    mount();
    await submit('gone');
    await vi.waitFor(() => {
      expect(badge()).toBe('1');
    });
    await openNotes();
    const del = [...shadow().querySelectorAll<HTMLButtonElement>('.entry button.link')].find(
      (b) => b.textContent.trim() === 'Delete',
    );
    if (!del) throw new Error('no delete');
    await userEvent.click(del);
    await vi.waitFor(() => {
      expect(query('.notes .meta')?.textContent).toBe('No notes yet.');
    });
    expect(await outbox().list()).toEqual([]);
    expect(badge()).toBe('');
  });

  it('lists a delivered note as sent, with nothing to edit', async () => {
    mount();
    await submit('sent');
    await outbox().flush(fakeTransport().transport);
    await openNotes();
    expect(query('.entry .meta')?.textContent).toContain('Delivered');
    expect(query('.entry button')).toBeNull();
  });

  it('shows a note being sent, with nothing to edit', async () => {
    mount();
    await submit('in flight');
    let release: () => void = () => undefined;
    const sending = outbox().flush(
      () =>
        new Promise((resolve) => {
          release = () => {
            resolve({ id: 'r' });
          };
        }),
    );
    await vi.waitFor(async () => {
      expect((await outbox().list())[0]?.sending).toBeDefined();
    });
    await openNotes();
    expect(query('.entry .meta')?.textContent).toContain('Sending…');
    expect(query('.entry button')).toBeNull();
    release();
    await sending;
  });

  it("doesn't submit the hidden form with Ctrl+Enter", async () => {
    mount();
    await handle?.open();
    await userEvent.type(textarea(), 'draft in progress');
    await openNotes();
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(await outbox().list()).toEqual([]);
    // Firefox treats Ctrl+Enter on the focused "New note" button as a click.
    if (modeButton()?.textContent.trim() === 'New note')
      await userEvent.click(el('#field-notes-mode'));
    expect(textarea().value).toBe('draft in progress');
  });

  it('has no axe violations', async () => {
    mount();
    await submit('a note');
    await openNotes();
    await userEvent.click(el('.entry button.link'));
    const results = await axe.run(shadow().host);
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
