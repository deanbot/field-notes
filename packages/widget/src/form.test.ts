import { type Note, NoteSchema } from '@field-notes/core/note';
import { userEvent } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deliver } from './deliver.ts';
import { TAG_NAME } from './element.ts';
import { type FieldNotesHandle, type FieldNotesOptions, mountFieldNotes } from './mount.ts';
import { TOAST_MS } from './panel.ts';

vi.mock('./deliver.ts', () => ({ deliver: vi.fn(() => Promise.resolve()) }));

const delivered = vi.mocked(deliver);
let handle: FieldNotesHandle | undefined;

function mount(options: FieldNotesOptions = {}): FieldNotesHandle {
  handle = mountFieldNotes({ enabled: true, ...options });
  return handle;
}

beforeEach(() => {
  localStorage.clear();
  delivered.mockClear();
  delivered.mockImplementation(() => Promise.resolve());
});

afterEach(() => {
  handle?.unmount();
  document.body.replaceChildren();
  getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
});

function shadow(): ShadowRoot {
  const root = document.querySelector(TAG_NAME)?.shadowRoot;
  if (!root) throw new Error('not mounted');
  return root;
}
const dialog = (): HTMLDialogElement | null => shadow().querySelector('dialog');
function textarea(): HTMLTextAreaElement {
  const el = shadow().querySelector('textarea');
  if (!el) throw new Error('no textarea');
  return el;
}
const chip = (value: string): HTMLInputElement | null =>
  shadow().querySelector(`input[name="type"][value="${value}"]`);
const errorText = (): string => shadow().querySelector('.error')?.textContent ?? '';
const toast = (): HTMLElement | null => shadow().querySelector('.toast');

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`no #${id}`);
  return el;
}

function lastNote(): Note {
  const note = delivered.mock.lastCall?.[0];
  if (!note) throw new Error('nothing delivered');
  return note;
}

describe('the form', () => {
  it.each(['popover', 'sheet', 'side'] as const)(
    'focuses the textarea on open (%s)',
    async (surface) => {
      await mount({ surface }).open();
      expect(shadow().activeElement).toBe(textarea());
    },
  );

  it('submits with Ctrl+Enter: a valid note, then closes and confirms', async () => {
    await mount({ author: 'Sam', environment: 'staging' }).open();
    await userEvent.type(textarea(), 'The total is wrong');
    const bug = chip('bug');
    if (!bug) throw new Error('no chip');
    await userEvent.click(bug);
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await vi.waitFor(() => {
      expect(delivered).toHaveBeenCalledOnce();
    });
    const note = lastNote();
    expect(NoteSchema.safeParse(note).success).toBe(true);
    expect(note).toMatchObject({
      body: 'The total is wrong',
      type: 'bug',
      author: 'Sam',
      environment: 'staging',
    });
    await vi.waitFor(() => {
      expect(dialog()).toBeNull();
    });
    expect(toast()?.matches(':popover-open')).toBe(true);
    expect(toast()?.textContent).toBe('Note added');
  });

  it('submits with Cmd+Enter and with the button', async () => {
    const h = mount();
    await h.open();
    await userEvent.type(textarea(), 'one');
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    await vi.waitFor(() => {
      expect(delivered).toHaveBeenCalledTimes(1);
    });
    await h.open();
    await userEvent.type(textarea(), 'two');
    const add = shadow().querySelector<HTMLButtonElement>('button.primary');
    if (!add) throw new Error('no submit button');
    await userEvent.click(add);
    await vi.waitFor(() => {
      expect(delivered).toHaveBeenCalledTimes(2);
    });
    expect(lastNote().body).toBe('two');
  });

  it('defaults environment to local and leaves the type out when none is chosen', async () => {
    await mount().open();
    await userEvent.type(textarea(), 'x');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await vi.waitFor(() => {
      expect(delivered).toHaveBeenCalledOnce();
    });
    expect(lastNote().environment).toBe('local');
    expect(lastNote()).not.toHaveProperty('type');
  });

  it('refuses an empty note', async () => {
    await mount().open();
    await userEvent.type(textarea(), '   ');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(delivered).not.toHaveBeenCalled();
    expect(errorText()).toBe('Write a note first.');
    expect(textarea().getAttribute('aria-invalid')).toBe('true');
    expect(dialog()?.open).toBe(true);
  });

  it('keeps the panel and the text when delivery fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    delivered.mockImplementation(() => Promise.reject(new Error('disk full')));
    await mount().open();
    await userEvent.type(textarea(), 'keep me');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await vi.waitFor(() => {
      expect(errorText()).toContain("Couldn't add the note");
    });
    expect(dialog()?.open).toBe(true);
    expect(textarea().value).toBe('keep me');
    expect(JSON.parse(localStorage.getItem('field-notes:draft') ?? '{}')).toMatchObject({
      text: 'keep me',
    });
  });

  it('offers the configured types, and a chosen chip clears on a second click', async () => {
    await mount({ types: ['a11y', 'copy', ''] }).open();
    expect(shadow().querySelectorAll('input[name="type"]')).toHaveLength(2);
    const copy = chip('copy');
    if (!copy) throw new Error('no chip');
    await userEvent.click(copy);
    expect(copy.checked).toBe(true);
    await userEvent.click(copy);
    expect(copy.checked).toBe(false);
    await userEvent.type(textarea(), 'x');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await vi.waitFor(() => {
      expect(delivered).toHaveBeenCalledOnce();
    });
    expect(lastNote()).not.toHaveProperty('type');
  });

  it('renders no type group when types is empty', async () => {
    await mount({ types: [] }).open();
    expect(shadow().querySelector('fieldset')).toBeNull();
  });
});

describe('metadata', () => {
  it('records the page selection, even when the trigger button takes the click', async () => {
    document.body.insertAdjacentHTML('beforeend', '<p id="quote">Place order now</p>');
    const quote = document.getElementById('quote');
    if (!quote) throw new Error('no text');
    getSelection()?.selectAllChildren(quote);
    mount();
    const button = shadow().querySelector<HTMLButtonElement>('button.trigger');
    if (!button) throw new Error('no button');
    await userEvent.click(button);
    await vi.waitFor(() => {
      expect(textarea()).toBeTruthy();
    });
    await userEvent.type(textarea(), 'copy');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await vi.waitFor(() => {
      expect(delivered).toHaveBeenCalledOnce();
    });
    expect(lastNote().selection).toBe('Place order now');
  });

  it('records the selection when opened with the hotkey', async () => {
    document.body.insertAdjacentHTML('beforeend', '<p id="quote">Checkout total</p>');
    const quote = document.getElementById('quote');
    if (!quote) throw new Error('no text');
    getSelection()?.selectAllChildren(quote);
    mount();
    await userEvent.keyboard('{Alt>}{Shift>}F{/Shift}{/Alt}');
    await vi.waitFor(() => {
      expect(textarea()).toBeTruthy();
    });
    await userEvent.type(textarea(), 'x');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await vi.waitFor(() => {
      expect(delivered).toHaveBeenCalledOnce();
    });
    expect(lastNote().selection).toBe('Checkout total');
  });

  it('takes a fresh selection on every open', async () => {
    const h = mount();
    document.body.insertAdjacentHTML('beforeend', '<p id="a">first</p><p id="b">second</p>');
    getSelection()?.selectAllChildren(byId('a'));
    await h.open();
    h.close();
    getSelection()?.selectAllChildren(byId('b'));
    await h.open();
    await userEvent.type(textarea(), 'x');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await vi.waitFor(() => {
      expect(delivered).toHaveBeenCalledOnce();
    });
    expect(lastNote().selection).toBe('second');
  });

  it('attaches context()', async () => {
    await mount({ context: () => Promise.resolve({ appVersion: '1.4.0' }) }).open();
    await userEvent.type(textarea(), 'x');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await vi.waitFor(() => {
      expect(delivered).toHaveBeenCalledOnce();
    });
    expect(lastNote().context).toEqual({ appVersion: '1.4.0' });
  });

  it('submits without context() when it throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await mount({
      context: () => {
        throw new Error('store not ready');
      },
    }).open();
    await userEvent.type(textarea(), 'x');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await vi.waitFor(() => {
      expect(delivered).toHaveBeenCalledOnce();
    });
    expect(lastNote()).not.toHaveProperty('context');
  });

  it('submits without context() when it never settles', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await mount({ context: () => new Promise(() => undefined) }).open();
    await userEvent.type(textarea(), 'x');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await vi.waitFor(
      () => {
        expect(delivered).toHaveBeenCalledOnce();
      },
      { timeout: 3000 },
    );
    expect(lastNote()).not.toHaveProperty('context');
  });

  it('attaches console errors when opted in', async () => {
    const host = vi.fn();
    console.error = host;
    mount({ consoleErrors: true });
    await vi.waitFor(() => {
      expect(console.error).not.toBe(host);
    });
    console.error('checkout failed', 502);
    await handle?.open();
    await userEvent.type(textarea(), 'x');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await vi.waitFor(() => {
      expect(delivered).toHaveBeenCalledOnce();
    });
    expect(lastNote().consoleErrors).toEqual(['checkout failed 502']);
    handle?.unmount();
    expect(console.error).toBe(host);
  });

  it('never installs console capture when unmounted while it loads', async () => {
    const host = vi.fn();
    console.error = host;
    mount({ consoleErrors: 5 }).unmount();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(console.error).toBe(host);
  });
});

describe('drafts', () => {
  it('survive unmount and remount, and clear on submit', async () => {
    await mount().open();
    await userEvent.type(textarea(), 'half a thought');
    const idea = chip('idea');
    if (!idea) throw new Error('no chip');
    await userEvent.click(idea);
    handle?.unmount();

    await mount().open();
    expect(textarea().value).toBe('half a thought');
    expect(chip('idea')?.checked).toBe(true);
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await vi.waitFor(() => {
      expect(delivered).toHaveBeenCalledOnce();
    });
    expect(localStorage.getItem('field-notes:draft')).toBeNull();

    await handle?.open();
    expect(textarea().value).toBe('');
  });
});

describe('teardown', () => {
  it('clears the toast timer on unmount', async () => {
    const timers = new Map<unknown, number>();
    const set = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      const id = set(fn, ms);
      timers.set(id, ms ?? 0);
      return id;
    }) as typeof setTimeout);
    const clear = vi.spyOn(globalThis, 'clearTimeout');

    await mount().open();
    await userEvent.type(textarea(), 'x');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await vi.waitFor(() => {
      expect(toast()?.matches(':popover-open')).toBe(true);
    });
    const toastTimer = [...timers].find(([, ms]) => ms === TOAST_MS)?.[0];
    expect(toastTimer).toBeDefined();
    handle?.unmount();
    expect(clear).toHaveBeenCalledWith(toastTimer);
  });

  it('clears the context() timer on unmount', async () => {
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    await mount({ context: () => new Promise(() => undefined) }).open();
    clear.mockClear();
    handle?.unmount();
    expect(clear).toHaveBeenCalled();
  });
});
