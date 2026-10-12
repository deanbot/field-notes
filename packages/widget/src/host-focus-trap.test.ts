// The widget opened while the host has its own focus trap active (#43).
import { type FocusTrap, createFocusTrap } from 'focus-trap';
import { userEvent } from 'vitest/browser';
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deliver } from './deliver.ts';
import { TAG_NAME } from './element.ts';
import { type FieldNotesHandle, type FieldNotesOptions, mountFieldNotes } from './mount.ts';

vi.mock('./deliver.ts', () => ({ deliver: vi.fn(() => Promise.resolve()) }));
const delivered = vi.mocked(deliver);

let handle: FieldNotesHandle | undefined;
let trap: FocusTrap | undefined;
const cleanups: (() => void)[] = [];

function mount(options: FieldNotesOptions = {}): FieldNotesHandle {
  handle = mountFieldNotes({ enabled: true, trigger: ['hotkey'], ...options });
  return handle;
}

/** A host modal: a container with two buttons, and something outside it. */
function hostModal(): {
  container: HTMLElement;
  first: HTMLButtonElement;
  second: HTMLButtonElement;
} {
  document.body.insertAdjacentHTML(
    'beforeend',
    '<div id="host-modal"><button id="host-first">first</button><button id="host-second">second</button></div><button id="host-outside">outside</button>',
  );
  const byId = (id: string): HTMLElement => {
    const found = document.getElementById(id);
    if (!found) throw new Error(`no #${id}`);
    return found;
  };
  const button = (id: string): HTMLButtonElement => {
    const found = byId(id);
    if (!(found instanceof HTMLButtonElement)) throw new Error(`#${id} isn't a button`);
    return found;
  };
  return {
    container: byId('host-modal'),
    first: button('host-first'),
    second: button('host-second'),
  };
}

/** The simplest trap: a capture-phase focusin listener that pulls focus back. */
function captureTrap(container: HTMLElement, home: HTMLElement): void {
  const pull = (event: FocusEvent): void => {
    if (!container.contains(event.target as Node)) home.focus();
  };
  document.addEventListener('focusin', pull, true);
  cleanups.push(() => {
    document.removeEventListener('focusin', pull, true);
  });
}

beforeEach(() => {
  localStorage.clear();
  delivered.mockClear();
});

afterEach(() => {
  handle?.unmount();
  trap?.deactivate({ returnFocus: false });
  trap = undefined;
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function shadow(): ShadowRoot {
  const root = document.querySelector(TAG_NAME)?.shadowRoot;
  if (!root) throw new Error('not mounted');
  return root;
}
const dialog = (): HTMLDialogElement | null => shadow().querySelector('dialog');
function el(selector: string): HTMLElement {
  const found = shadow().querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`no ${selector}`);
  return found;
}
const active = (): Element | null => shadow().activeElement;

describe('a capture-phase focusin trap, no hooks', () => {
  it('keeps focus in the widget, tabs inside it, and gives focus back on Esc', async () => {
    const { container, first } = hostModal();
    first.focus();
    captureTrap(container, first);
    mount();
    await userEvent.keyboard('{Alt>}{Shift>}F{/Shift}{/Alt}');
    await vi.waitFor(() => {
      expect(dialog()?.open).toBe(true);
    });
    expect(active()).toBe(el('#field-notes-text'));
    await userEvent.keyboard('works');
    expect((el('#field-notes-text') as HTMLTextAreaElement).value).toBe('works');
    // Native Tab: it moves within the dialog, or (WebKit, which by default
    // tabs only between text fields) out to the browser, never to the host.
    await userEvent.tab();
    expect(container.contains(document.activeElement)).toBe(false);
    if (active()) expect(dialog()?.contains(active())).toBe(true);
    await userEvent.click(el('input[value="bug"]'));
    expect((el('input[value="bug"]') as HTMLInputElement).checked).toBe(true);
    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => {
      expect(dialog()).toBeNull();
    });
    expect(document.activeElement).toBe(first);
  });
});

describe('focus-trap with its defaults, no hooks', () => {
  async function openUnderTrap(): Promise<{ container: HTMLElement; escapes: () => number }> {
    const { container } = hostModal();
    let escapes = 0;
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') escapes++;
    };
    document.addEventListener('keydown', onEscape);
    cleanups.push(() => {
      document.removeEventListener('keydown', onEscape);
    });
    trap = createFocusTrap(container);
    trap.activate();
    await vi.waitFor(() => {
      expect(container.contains(document.activeElement)).toBe(true);
    });
    await mount().open();
    return { container, escapes: () => escapes };
  }

  it('keeps focus and typing in the widget, since the page behind it is inert', async () => {
    await openUnderTrap();
    expect(active()).toBe(el('#field-notes-text'));
    await userEvent.keyboard('typed under a trap');
    expect((el('#field-notes-text') as HTMLTextAreaElement).value).toBe('typed under a trap');
  });

  it('repairs Tab and Shift+Tab, which the trap cancels, wrapping inside the dialog', async () => {
    await openUnderTrap();
    const visited: (Element | null)[] = [];
    for (let i = 0; i < 8; i++) {
      await userEvent.tab();
      visited.push(active());
      expect(dialog()?.contains(active())).toBe(true);
    }
    // One stop for the whole chip group, however many laps.
    const radios = visited.filter((e) => e instanceof HTMLInputElement && e.type === 'radio');
    expect(radios.length).toBeGreaterThan(0);
    expect(new Set(radios).size).toBe(1);
    expect(new Set(visited).size).toBeLessThan(visited.length); // it wrapped
    await userEvent.tab({ shift: true });
    expect(dialog()?.contains(active())).toBe(true);
  });

  it('repairs click-to-focus, which the trap cancels on mousedown', async () => {
    await openUnderTrap();
    el('button.close').focus();
    await userEvent.click(el('#field-notes-text'));
    expect(active()).toBe(el('#field-notes-text'));
  });

  it('closes on Esc without deactivating the host trap or reaching its Esc listener', async () => {
    const { escapes } = await openUnderTrap();
    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => {
      expect(dialog()).toBeNull();
    });
    expect(trap?.active).toBe(true);
    expect(escapes()).toBe(0);
  });

  it('leaves Esc on the host page to the host', async () => {
    const { escapes } = await openUnderTrap();
    handle?.close();
    await userEvent.keyboard('{Escape}');
    expect(escapes()).toBe(1);
  });

  it('submits with Ctrl+Enter, but the trap blocks clicks, by mouse or keyboard', async () => {
    await openUnderTrap();
    // The boundary the recipe documents: clicks need the host to pause its trap.
    await userEvent.click(el('input[value="bug"]'));
    expect((el('input[value="bug"]') as HTMLInputElement).checked).toBe(false);
    el('button.primary').focus();
    await userEvent.keyboard('{Enter}');
    expect(delivered).not.toHaveBeenCalled();
    el('#field-notes-text').focus();
    await userEvent.keyboard('keyboard only');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await vi.waitFor(() => {
      expect(delivered).toHaveBeenCalledOnce();
    });
  });
});

describe('focus-trap paused through onOpen/onClose (the recipe)', () => {
  it('lets every control work, and the host trap resumes afterwards', async () => {
    const { container } = hostModal();
    trap = createFocusTrap(container);
    trap.activate();
    const paused = trap;
    mount({
      onOpen: () => paused.pause(),
      onClose: () => paused.unpause(),
    });
    await handle?.open();
    expect(trap.paused).toBe(true);
    await userEvent.type(el('#field-notes-text'), 'all controls');
    await userEvent.click(el('input[value="idea"]'));
    expect((el('input[value="idea"]') as HTMLInputElement).checked).toBe(true);
    await userEvent.click(el('button.primary'));
    await vi.waitFor(() => {
      expect(delivered).toHaveBeenCalledOnce();
    });
    expect(delivered.mock.lastCall?.[0]).toMatchObject({ body: 'all controls', type: 'idea' });
    await vi.waitFor(() => {
      expect(dialog()).toBeNull();
    });
    expect(trap.paused).toBe(false);
    expect(trap.active).toBe(true);
    await vi.waitFor(() => {
      expect(container.contains(document.activeElement)).toBe(true);
    });
  });
});

describe('onOpen and onClose', () => {
  function hooks(): { onOpen: Mock<() => void>; onClose: Mock<() => void> } {
    return { onOpen: vi.fn<() => void>(), onClose: vi.fn<() => void>() };
  }

  it('fire once per open and close, on every way of closing', async () => {
    const calls = hooks();
    const h = mount({ ...calls, trigger: ['button', 'hotkey'] });
    const closers: [string, () => Promise<void>][] = [
      [
        'close()',
        () => {
          h.close();
          return Promise.resolve();
        },
      ],
      ['toggle()', () => h.toggle()],
      ['the close button', () => userEvent.click(el('button.close'))],
      ['Esc', () => userEvent.keyboard('{Escape}')],
      ['the hotkey', () => userEvent.keyboard('{Alt>}{Shift>}F{/Shift}{/Alt}')],
      [
        'a click outside the popover',
        async () => {
          const box = el('dialog').getBoundingClientRect();
          await userEvent.click(el('dialog'), { position: { x: box.width / 2, y: -20 } });
        },
      ],
      [
        'a submit',
        async () => {
          await userEvent.type(el('#field-notes-text'), 'x');
          await userEvent.keyboard('{Control>}{Enter}{/Control}');
        },
      ],
    ];
    for (const [name, closeIt] of closers) {
      calls.onOpen.mockClear();
      calls.onClose.mockClear();
      await h.open();
      expect(calls.onOpen, name).toHaveBeenCalledOnce();
      await closeIt();
      await vi.waitFor(() => {
        expect(dialog(), name).toBeNull();
      });
      expect(calls.onClose, name).toHaveBeenCalledOnce();
    }
  });

  it('closes on unmount while open', async () => {
    const calls = hooks();
    await mount(calls).open();
    handle?.unmount();
    expect(calls.onClose).toHaveBeenCalledOnce();
  });

  it("don't fire for an open cancelled while the panel loads, or a second close", async () => {
    const calls = hooks();
    const h = mount(calls);
    const opening = h.open();
    h.close();
    await opening;
    expect(calls.onOpen).not.toHaveBeenCalled();
    expect(calls.onClose).not.toHaveBeenCalled();
    await h.open();
    h.close();
    h.close();
    expect(calls.onClose).toHaveBeenCalledOnce();
  });

  it("can't stop the widget opening or closing by throwing", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const h = mount({
      onOpen: () => {
        throw new Error('open hook');
      },
      onClose: () => {
        throw new Error('close hook');
      },
    });
    await h.open();
    expect(dialog()?.open).toBe(true);
    h.close();
    expect(dialog()).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('a hook threw'));
  });

  it('warns that a second mount drops its hooks', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mount();
    mountFieldNotes({ enabled: true, onOpen: () => undefined });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('these are ignored'));
  });
});
