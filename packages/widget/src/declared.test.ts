// <field-notes> elements the page declares itself, as a framework renders
// them, carrying the widget once defineFieldNotes() has run.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HANDLE_KEY, TAG_NAME } from './element.ts';
import { defineFieldNotes } from './index.ts';
import { type FieldNotesHandle, findMount, mountFieldNotes } from './mount.ts';
import { startScriptTag } from './script-tag.ts';

type Shell = HTMLElement & { [HANDLE_KEY]?: FieldNotesHandle };

function declare(attributes: Record<string, string> = {}): Shell {
  const el: Shell = document.createElement(TAG_NAME);
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
  return el;
}

const button = (el: Element): HTMLElement | null =>
  el.shadowRoot?.querySelector<HTMLElement>('button.trigger') ?? null;
const carries = (el: Element): boolean => button(el) !== null;
/** Long enough for the lazy chunk, once loaded, and a reconcile to run. */
const settle = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 30);
  });

async function mounted(el: Shell): Promise<FieldNotesHandle> {
  await vi.waitFor(() => {
    expect(carries(el)).toBe(true);
  });
  const handle = el[HANDLE_KEY];
  if (!handle) throw new Error('no handle');
  return handle;
}

afterEach(async () => {
  for (const el of document.querySelectorAll<Shell>(TAG_NAME)) {
    el[HANDLE_KEY]?.unmount();
    el.remove();
  }
  await settle();
  vi.restoreAllMocks();
});

describe('defineFieldNotes', () => {
  it('mounts a <field-notes> already in the page, configured by its attributes', async () => {
    const el = declare({ position: 'top-left', offset: '8,24' });
    const where = document.createElement('div');
    where.append(el);
    document.body.append(where);
    defineFieldNotes({ screenshot: 'off' });
    await mounted(el);
    expect([button(el)?.style.top, button(el)?.style.left]).toEqual(['24px', '8px']);
    // Where the page put it, and the only one.
    expect(el.parentElement).toBe(where);
    expect(document.querySelectorAll(TAG_NAME)).toHaveLength(1);
    where.remove();
  });

  it("mounts one rendered later, its attributes over defineFieldNotes()'s options", async () => {
    defineFieldNotes({ screenshot: 'off', buttonPosition: 'top-left', buttonOffset: 30 });
    await settle();
    const el = declare({ position: 'bottom-right' });
    document.body.append(el);
    await mounted(el);
    expect([button(el)?.style.bottom, button(el)?.style.right]).toEqual(['30px', '30px']);
    expect(button(el)?.style.top).toBe('');
  });

  it('reads attributes a framework sets just after adding it', async () => {
    defineFieldNotes({ screenshot: 'off' });
    await settle();
    const el = declare();
    document.body.append(el);
    el.setAttribute('position', 'top-left');
    await mounted(el);
    expect(button(el)?.style.top).toBe('16px');
  });

  it('opens its surface, from the button and from the handle', async () => {
    defineFieldNotes({ screenshot: 'off' });
    const el = declare();
    document.body.append(el);
    const handle = await mounted(el);
    button(el)?.click();
    await vi.waitFor(() => {
      expect(el.shadowRoot?.querySelector('h2')).not.toBeNull();
    });
    handle.close();
    expect(button(el)?.getAttribute('aria-expanded')).toBe('false');
  });

  it('removed by the framework, it takes the widget and its listeners with it', async () => {
    const signals: AbortSignal[] = [];
    // Called back with .apply(this) below, so unbinding it is fine.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const add = EventTarget.prototype.addEventListener;
    vi.spyOn(EventTarget.prototype, 'addEventListener').mockImplementation(function (
      this: EventTarget,
      ...args
    ) {
      const options = args[2];
      if (this === document && typeof options === 'object' && options.signal) {
        signals.push(options.signal);
      }
      add.apply(this, args);
    });
    defineFieldNotes({ screenshot: 'off' });
    const el = declare();
    document.body.append(el);
    const handle = await mounted(el);
    expect(signals.length, 'the hotkey listens on the document').toBeGreaterThan(0);

    el.remove();
    await settle();
    expect(handle.active).toBe(false);
    expect(el.shadowRoot?.childNodes).toHaveLength(0);
    expect(findMount()).toBeUndefined();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it.each(['the old one goes first', 'the new one comes first'])(
    'a framework swapping one for another leaves one widget, on the new one: %s',
    async (order) => {
      const warn = vi.spyOn(console, 'warn');
      defineFieldNotes({ screenshot: 'off' });
      const old = declare();
      document.body.append(old);
      const first = await mounted(old);
      const next = declare();
      if (order === 'the old one goes first') {
        old.remove();
        document.body.append(next);
      } else {
        document.body.append(next);
        old.remove();
      }
      const second = await mounted(next);
      expect(first.active).toBe(false);
      expect(carries(old)).toBe(false);
      expect(findMount()).toBe(second);
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it('moved by the framework, it carries a fresh widget, closed, as the page shows it', async () => {
    defineFieldNotes({ screenshot: 'off' });
    const el = declare();
    document.body.append(el);
    const first = await mounted(el);
    await first.open();
    const wrapper = document.createElement('div');
    document.body.append(wrapper);
    // Leaving the page closed its button's popover and its surface.
    wrapper.append(el);
    await vi.waitFor(() => {
      expect(el[HANDLE_KEY]).not.toBe(first);
    });
    const second = await mounted(el);
    expect([first.active, second.active]).toEqual([false, true]);
    expect(button(el)?.matches(':popover-open')).toBe(true);
    expect(button(el)?.getAttribute('aria-expanded')).toBe('false');
    expect(el.shadowRoot?.querySelector('dialog')).toBeNull();
    expect(document.querySelectorAll(TAG_NAME)).toHaveLength(1);
    wrapper.remove();
  });

  it('removed and added again, it carries the widget again', async () => {
    defineFieldNotes({ screenshot: 'off' });
    const el = declare();
    document.body.append(el);
    const first = await mounted(el);
    el.remove();
    await settle();
    document.body.append(el);
    const second = await mounted(el);
    expect(second).not.toBe(first);
    expect(el.shadowRoot?.querySelectorAll('button.trigger')).toHaveLength(1);
  });

  it("stays empty after its handle's unmount(), wherever it's moved", async () => {
    defineFieldNotes({ screenshot: 'off' });
    const el = declare();
    document.body.append(el);
    const handle = await mounted(el);
    handle.unmount();
    // The page's element: emptied, not removed.
    expect(el.isConnected).toBe(true);
    expect(carries(el)).toBe(false);
    el.remove();
    document.body.append(el);
    await settle();
    expect(carries(el)).toBe(false);
    expect(findMount()).toBeUndefined();
  });

  it("stays empty while mountFieldNotes()'s widget is live, and takes over when it goes", async () => {
    const warn = vi.spyOn(console, 'warn');
    const own = mountFieldNotes({ screenshot: 'off' });
    defineFieldNotes({ screenshot: 'off' });
    const el = declare();
    document.body.append(el);
    await settle();
    expect(carries(el)).toBe(false);
    expect(findMount()).toBe(own);
    expect(warn).not.toHaveBeenCalled();

    own.unmount();
    await mounted(el);
    expect(document.querySelectorAll(TAG_NAME)).toHaveLength(1);
  });

  it("mountFieldNotes() and a script tag share a declared element's widget", async () => {
    defineFieldNotes({ screenshot: 'off' });
    const el = declare();
    document.body.append(el);
    const handle = await mounted(el);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(mountFieldNotes()).toBe(handle);

    const api = startScriptTag(document.createElement('script'));
    await api.open();
    expect(button(el)?.getAttribute('aria-expanded')).toBe('true');
    api.unmount();
    expect(handle.active).toBe(true);
    expect(document.querySelectorAll(TAG_NAME)).toHaveLength(1);
  });

  it("carries the widget inside a component's shadow root, and mountFieldNotes() finds it", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    defineFieldNotes({ screenshot: 'off' });
    await settle();
    const host = document.createElement('div');
    document.body.append(host);
    const el = declare({ position: 'top-left' });
    host.attachShadow({ mode: 'open' }).append(el);
    const handle = await mounted(el);
    expect(button(el)?.style.top).toBe('16px');
    expect(findMount()).toBe(handle);
    expect(mountFieldNotes({ screenshot: 'off' })).toBe(handle);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('already mounted'));
    expect(document.querySelectorAll(TAG_NAME)).toHaveLength(0);

    // A light-DOM one waits for it, and takes over when the component goes.
    const other = declare();
    document.body.append(other);
    await settle();
    expect(carries(other)).toBe(false);
    host.remove();
    await mounted(other);
    expect(handle.active).toBe(false);
    // Out of the page, it isn't a candidate any more.
    other.remove();
    await settle();
    expect(carries(el)).toBe(false);
    expect(findMount()).toBeUndefined();
  });

  it('leaves it empty when its enabled attribute says no', async () => {
    defineFieldNotes({ screenshot: 'off' });
    const el = declare({ enabled: 'false' });
    document.body.append(el);
    await settle();
    expect(carries(el)).toBe(false);
  });
});
