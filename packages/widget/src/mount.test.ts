import { afterEach, describe, expect, it, vi } from 'vitest';
import { HANDLE_KEY, TAG_NAME } from './element.ts';
import { type FieldNotesHandle, mountFieldNotes } from './mount.ts';
import type * as MountModule from './mount.ts';

const mounts: FieldNotesHandle[] = [];

function mount(...args: Parameters<typeof mountFieldNotes>): FieldNotesHandle {
  const handle = mountFieldNotes(...args);
  mounts.push(handle);
  return handle;
}

const elements = (): NodeListOf<HTMLElement> => document.querySelectorAll(TAG_NAME);

function shadow(): ShadowRoot {
  const root = document.querySelector(TAG_NAME)?.shadowRoot;
  if (!root) throw new Error('no mounted shadow root');
  return root;
}

const panel = (): Element | null => shadow().querySelector('dialog');

afterEach(() => {
  for (const handle of mounts.splice(0)) handle.unmount();
  vi.restoreAllMocks();
});

describe('mountFieldNotes', () => {
  // First, before anything in this file has opened the widget.
  it('loads no Lit until the first open', async () => {
    const handle = mount({ enabled: true });
    expect(panel()).toBeNull();
    expect('litHtmlVersions' in globalThis).toBe(false);
    await handle.open();
    expect('litHtmlVersions' in globalThis).toBe(true);
    expect(panel()).not.toBeNull();
  });

  it('is a valid custom element name', () => {
    expect(TAG_NAME).toMatch(/^[a-z][a-z0-9]*-[a-z0-9-]*$/);
  });

  it('mounts one <field-notes> with its own shadow root', () => {
    const handle = mount({ enabled: true });
    expect(handle.active).toBe(true);
    expect(elements()).toHaveLength(1);
    expect(shadow().mode).toBe('open');
  });

  it.each([
    ['false', { enabled: false }],
    ['a function returning false', { enabled: () => false }],
  ])('does nothing when enabled is %s', async (_, options) => {
    const handle = mount(options);
    expect(handle.active).toBe(false);
    await handle.open();
    handle.close();
    handle.unmount();
    expect(elements()).toHaveLength(0);
  });

  it('is on by default outside a production build', () => {
    expect(mount().active).toBe(true);
  });

  it('opens, closes and reopens', async () => {
    const handle = mount({ enabled: true });
    await handle.open();
    await handle.open();
    expect(shadow().querySelectorAll('dialog')).toHaveLength(1);
    handle.close();
    expect(panel()).toBeNull();
    await handle.open();
    expect(panel()).not.toBeNull();
  });

  it("closes from the panel's own close button", async () => {
    const handle = mount({ enabled: true });
    await handle.open();
    shadow().querySelector('button')?.click();
    expect(panel()).toBeNull();
  });

  it('stays closed when close() runs while the panel loads', async () => {
    const handle = mount({ enabled: true });
    const opening = handle.open();
    handle.close();
    await opening;
    expect(panel()).toBeNull();
  });

  it('renders nothing when unmount() runs while the panel loads', async () => {
    const handle = mount({ enabled: true });
    const root = shadow();
    const opening = handle.open();
    handle.unmount();
    await opening;
    expect(root.querySelector('dialog')).toBeNull();
    expect(handle.active).toBe(false);
  });

  it('unmount() removes the element and leaves no listeners on the page', async () => {
    interface Entry {
      target: EventTarget;
      type: string;
      listener: unknown;
      signal?: AbortSignal | undefined;
    }
    const added: Entry[] = [];
    const removed: Entry[] = [];
    const page = new Set<EventTarget>([window, document, document.documentElement, document.body]);
    // Called back with .apply(this) below, so unbinding them is fine.
    /* eslint-disable @typescript-eslint/unbound-method */
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    /* eslint-enable @typescript-eslint/unbound-method */
    vi.spyOn(EventTarget.prototype, 'addEventListener').mockImplementation(function (
      this: EventTarget,
      ...args
    ) {
      const [type, listener, options] = args;
      const signal = typeof options === 'object' ? options.signal : undefined;
      if (page.has(this)) added.push({ target: this, type, listener, signal });
      add.apply(this, args);
    });
    vi.spyOn(EventTarget.prototype, 'removeEventListener').mockImplementation(function (
      this: EventTarget,
      ...args
    ) {
      const [type, listener] = args;
      if (page.has(this)) removed.push({ target: this, type, listener });
      remove.apply(this, args);
    });

    // The window's own methods aren't the prototype's here: watch them too.
    const addToWindow = window.addEventListener.bind(window);
    const removeFromWindow = window.removeEventListener.bind(window);
    vi.spyOn(window, 'addEventListener').mockImplementation((...args) => {
      const [type, listener, options] = args;
      const signal = typeof options === 'object' ? options.signal : undefined;
      added.push({ target: window, type, listener, signal });
      addToWindow(...args);
    });
    vi.spyOn(window, 'removeEventListener').mockImplementation((...args) => {
      const [type, listener] = args;
      removed.push({ target: window, type, listener });
      removeFromWindow(...args);
    });

    // A pending note and a token load delivery too, with its own listeners.
    localStorage.setItem('field-notes:pending', '1');
    const handle = mount({ enabled: true, token: 't', endpoint: '/no-sink-here' });
    await handle.open();
    handle.close();
    expect(added.length, 'the hotkey listens on the page').toBeGreaterThan(0);
    await vi.waitFor(() => {
      expect(added.map((entry) => entry.type)).toContain('online');
    });
    handle.unmount();
    localStorage.clear();
    handle.unmount();

    const live = added.filter(
      (entry) =>
        !entry.signal?.aborted &&
        !removed.some(
          (gone) =>
            gone.target === entry.target &&
            gone.type === entry.type &&
            gone.listener === entry.listener,
        ),
    );
    expect(elements()).toHaveLength(0);
    expect(live.map((entry) => entry.type)).toEqual([]);
    expect(handle.active).toBe(false);
    await handle.open();
    expect(elements()).toHaveLength(0);
  });

  it('mounts again after unmount()', () => {
    mount({ enabled: true }).unmount();
    expect(mount({ enabled: true }).active).toBe(true);
    expect(elements()).toHaveLength(1);
  });

  it('warns and reuses the existing mount when mounted twice', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const first = mount({ enabled: true });
    const second = mount({ enabled: true });
    expect(second).toBe(first);
    expect(elements()).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('already mounted'));
  });

  it('reuses a mount made by another copy of the widget', async () => {
    // A second module instance stands in for the script-tag build next to
    // the npm import: separate module state, separate element class.
    const url = './mount.ts?copy';
    const copy = (await import(/* @vite-ignore */ url)) as typeof MountModule;
    expect(copy.mountFieldNotes).not.toBe(mountFieldNotes);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const first = mount({ enabled: true });
    expect(copy.mountFieldNotes({ enabled: true })).toBe(first);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('already mounted'));

    first.unmount();
    warn.mockClear();
    const fromCopy = copy.mountFieldNotes({ enabled: true });
    mounts.push(fromCopy);
    expect(fromCopy.active).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    const el = document.querySelector<HTMLElement & Record<symbol, unknown>>(TAG_NAME);
    expect(el?.[HANDLE_KEY]).toBe(fromCopy);
  });

  it('appends to <html> when there is no <body> yet', () => {
    const body = document.body;
    body.remove();
    try {
      mount({ enabled: true });
      expect(document.documentElement.lastElementChild?.tagName).toBe(TAG_NAME.toUpperCase());
    } finally {
      document.documentElement.append(body);
    }
  });
});
