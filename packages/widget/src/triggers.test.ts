import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TAG_NAME } from './element.ts';
import { type FieldNotesHandle, type FieldNotesOptions, mountFieldNotes } from './mount.ts';

let handle: FieldNotesHandle | undefined;

function mount(options: FieldNotesOptions = {}): FieldNotesHandle {
  handle = mountFieldNotes({ enabled: true, ...options });
  return handle;
}

afterEach(() => {
  handle?.unmount();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function shadow(): ShadowRoot {
  const root = document.querySelector(TAG_NAME)?.shadowRoot;
  if (!root) throw new Error('no mounted shadow root');
  return root;
}

const button = (): HTMLButtonElement | null => shadow().querySelector('button.trigger');
const isOpen = (): boolean => shadow().querySelector('[role="dialog"]') !== null;

/** Presses Alt+Shift+F on `target` the way macOS reports it, and returns the event. */
function pressHotkey(target: EventTarget = document.body, init: KeyboardEventInit = {}): Event {
  const event = new KeyboardEvent('keydown', {
    code: 'KeyF',
    key: 'Ï',
    altKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
    composed: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

describe('button', () => {
  it('renders by default, bottom-right, in the top layer', () => {
    mount();
    const el = button();
    expect(el).not.toBeNull();
    expect(el?.style.bottom).toBe('16px');
    expect(el?.style.right).toBe('16px');
    expect(el?.matches(':popover-open')).toBe(true);
    expect(el?.getAttribute('aria-label')).toBe('Field notes');
  });

  it('takes a corner and an offset per edge', () => {
    mount({ buttonPosition: 'top-left', buttonOffset: { x: 8, y: 24 } });
    expect(button()?.style.top).toBe('24px');
    expect(button()?.style.left).toBe('8px');
  });

  it('stays clickable under a host overlay at the maximum z-index', () => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgb(0 0 0/.1)';
    document.body.append(overlay);
    mount();
    const rect = button()?.getBoundingClientRect();
    if (!rect) throw new Error('no button');
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    expect(hit?.tagName).toBe(TAG_NAME.toUpperCase());
  });

  it('opens and closes the surface, and reports it in aria-expanded', async () => {
    mount();
    button()?.click();
    await vi.waitFor(() => {
      expect(isOpen()).toBe(true);
    });
    expect(button()?.getAttribute('aria-expanded')).toBe('true');
    button()?.click();
    expect(isOpen()).toBe(false);
    expect(button()?.getAttribute('aria-expanded')).toBe('false');
  });

  it('is absent with a hotkey-only config', () => {
    mount({ trigger: ['hotkey'] });
    expect(button()).toBeNull();
  });
});

describe('hotkey', () => {
  it('opens and closes the surface from a real keyboard', async () => {
    mount({ trigger: ['hotkey'] });
    await userEvent.keyboard('{Alt>}{Shift>}F{/Shift}{/Alt}');
    await vi.waitFor(() => {
      expect(isOpen()).toBe(true);
    });
    await userEvent.keyboard('{Alt>}{Shift>}F{/Shift}{/Alt}');
    expect(isOpen()).toBe(false);
  });

  it('claims the key it owns and no other', async () => {
    mount();
    expect(pressHotkey().defaultPrevented).toBe(true);
    await vi.waitFor(() => {
      expect(isOpen()).toBe(true);
    });
    expect(pressHotkey(document.body, { code: 'KeyG', key: 'G' }).defaultPrevented).toBe(false);
    expect(pressHotkey(document.body, { altKey: false }).defaultPrevented).toBe(false);
  });

  it.each([
    ['<input>', 'input'],
    ['<textarea></textarea>', 'textarea'],
    ['<div contenteditable="true"></div>', 'div'],
  ])('never opens while typing in a host %s', async (html, selector) => {
    mount();
    document.body.insertAdjacentHTML('beforeend', html);
    const field = document.querySelector(selector);
    if (!field) throw new Error('no field');
    expect(pressHotkey(field).defaultPrevented).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(isOpen()).toBe(false);
  });

  it('never opens while typing in a field inside a host shadow root', async () => {
    mount();
    const host = document.createElement('div');
    document.body.append(host);
    const input = document.createElement('input');
    host.attachShadow({ mode: 'open' }).append(input);
    expect(pressHotkey(input).defaultPrevented).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(isOpen()).toBe(false);
  });

  it("still toggles from a field inside the widget's own shadow root", async () => {
    mount();
    const input = document.createElement('input');
    shadow().append(input);
    expect(pressHotkey(input).defaultPrevented).toBe(true);
    await vi.waitFor(() => {
      expect(isOpen()).toBe(true);
    });
  });

  it('ignores repeats and keys the host already handled', async () => {
    mount();
    expect(pressHotkey(document.body, { repeat: true }).defaultPrevented).toBe(false);
    document.body.addEventListener(
      'keydown',
      (event) => {
        event.preventDefault();
      },
      { once: true },
    );
    pressHotkey();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(isOpen()).toBe(false);
  });

  it('takes a custom shortcut', async () => {
    mount({ hotkey: 'Ctrl+Shift+K' });
    expect(pressHotkey().defaultPrevented).toBe(false);
    pressHotkey(document.body, { code: 'KeyK', key: 'K', altKey: false, ctrlKey: true });
    await vi.waitFor(() => {
      expect(isOpen()).toBe(true);
    });
  });

  it('warns and stays off for a shortcut it cannot parse', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mount({ hotkey: 'Hyper+F' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('the hotkey is off'));
    expect(pressHotkey().defaultPrevented).toBe(false);
  });

  it('is off with a button-only config', () => {
    mount({ trigger: ['button'] });
    expect(pressHotkey().defaultPrevented).toBe(false);
  });
});

describe('API', () => {
  it('toggle() works with no trigger at all', async () => {
    const h = mount({ trigger: [] });
    expect(button()).toBeNull();
    expect(pressHotkey().defaultPrevented).toBe(false);
    await h.toggle();
    expect(isOpen()).toBe(true);
    await h.toggle();
    expect(isOpen()).toBe(false);
  });

  it('toggle() while the panel loads cancels the open', async () => {
    const h = mount();
    const opening = h.toggle();
    await h.toggle();
    await opening;
    expect(isOpen()).toBe(false);
  });

  it('is a no-op on an inactive handle', async () => {
    const h = mountFieldNotes({ enabled: false });
    await h.toggle();
    expect(document.querySelector(TAG_NAME)).toBeNull();
  });
});
