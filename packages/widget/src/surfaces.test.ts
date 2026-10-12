import axe from 'axe-core';
import { page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TAG_NAME } from './element.ts';
import { type FieldNotesHandle, type FieldNotesOptions, mountFieldNotes } from './mount.ts';
import type { Surface } from './panel.ts';

let handle: FieldNotesHandle | undefined;

function mount(options: FieldNotesOptions = {}): FieldNotesHandle {
  handle = mountFieldNotes({ enabled: true, ...options });
  return handle;
}

afterEach(() => {
  handle?.unmount();
  document.body.replaceChildren();
  document.head.querySelectorAll('style[data-test]').forEach((style) => {
    style.remove();
  });
  vi.restoreAllMocks();
});

const host = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>(TAG_NAME);
  if (!el?.shadowRoot) throw new Error('not mounted');
  return el;
};
function shadow(): ShadowRoot {
  const root = host().shadowRoot;
  if (!root) throw new Error('not mounted');
  return root;
}
const dialog = (): HTMLDialogElement | null => shadow().querySelector('dialog');
const button = (): HTMLButtonElement | null => shadow().querySelector('button.trigger');

function openDialog(): HTMLDialogElement {
  const el = dialog();
  if (!el?.open) throw new Error('no open dialog');
  return el;
}

const HOTKEY = '{Alt>}{Shift>}F{/Shift}{/Alt}';
const SURFACES: Surface[] = ['popover', 'sheet', 'side'];

describe('trigger × surface', () => {
  const triggers = ['button', 'hotkey', 'api'] as const;
  const cases = triggers.flatMap((trigger) =>
    SURFACES.map((surface) => [trigger, surface] as const),
  );

  it.each(cases)('%s opens and closes the %s', async (trigger, surface) => {
    const h = mount({ trigger: trigger === 'api' ? [] : [trigger], surface });

    if (trigger === 'button') {
      const el = button();
      if (!el) throw new Error('no button');
      await userEvent.click(el);
    } else if (trigger === 'hotkey') {
      await userEvent.keyboard(HOTKEY);
    } else {
      await h.open();
    }
    await vi.waitFor(() => openDialog());
    // A popover anchors to the button; with no button it opens as a sheet.
    const expected = surface === 'popover' && trigger !== 'button' ? 'sheet' : surface;
    expect(openDialog().classList.contains(expected)).toBe(true);

    if (trigger === 'button' && surface === 'popover') {
      // The page, button included, is inert behind the modal dialog, so a
      // click on the button's spot lands outside the popover and closes it.
      const at = button()?.getBoundingClientRect();
      const box = openDialog().getBoundingClientRect();
      if (!at) throw new Error('no button');
      await userEvent.click(openDialog(), {
        position: { x: at.x + at.width / 2 - box.x, y: at.y + at.height / 2 - box.y },
      });
    } else if (trigger === 'button') {
      // The sheet and side panel cover the corner button: close from inside.
      const close = openDialog().querySelector<HTMLButtonElement>('button.close');
      if (!close) throw new Error('no close button');
      await userEvent.click(close);
    } else if (trigger === 'hotkey') {
      await userEvent.keyboard(HOTKEY);
    } else {
      h.close();
    }
    await vi.waitFor(() => {
      expect(dialog()).toBeNull();
    });
  });
});

describe.each(SURFACES)('%s', (surface) => {
  it('has no axe violations', async () => {
    await mount({ surface }).open();
    const results = await axe.run(host());
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });

  it('closes on Esc and opens again on the next toggle()', async () => {
    const h = mount({ surface });
    await h.open();
    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => {
      expect(dialog()).toBeNull();
    });
    expect(button()?.getAttribute('aria-expanded')).toBe('false');
    await h.toggle();
    expect(openDialog()).toBeTruthy();
  });

  it('stays open when reopened straight after closing', async () => {
    const h = mount({ surface });
    await h.open();
    h.close();
    await h.open();
    // The closed dialog's close event fires a task later; it mustn't close this one.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(dialog()?.open).toBe(true);
  });

  it('is not covered by a host overlay at the maximum z-index', async () => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgb(0 0 0/.1)';
    document.body.append(overlay);
    await mount({ surface }).open();
    const box = openDialog().getBoundingClientRect();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    expect(document.elementFromPoint(x, y)).toBe(host());
    expect(openDialog().contains(shadow().elementFromPoint(x, y))).toBe(true);
  });

  it('keeps focus off the host page while open', async () => {
    const before = document.createElement('button');
    const after = document.createElement('button');
    document.body.prepend(before);
    document.body.append(after);
    await mount({ surface }).open();
    // The page is inert. Tab moves within the dialog, or out to the
    // browser's own UI, never onto the host's controls.
    for (const shift of [false, false, false, true, true, true]) {
      await userEvent.tab({ shift });
      expect([before, after]).not.toContain(document.activeElement);
      const inside = shadow().activeElement;
      if (inside) expect(openDialog().contains(inside)).toBe(true);
    }
  });

  it('takes colours from --field-notes-* custom properties', async () => {
    const style = document.createElement('style');
    style.dataset.test = '';
    style.textContent = `${TAG_NAME} { --field-notes-bg: rgb(1, 2, 3); --field-notes-fg: rgb(250, 251, 252); }`;
    document.head.append(style);
    await mount({ surface }).open();
    const computed = getComputedStyle(openDialog());
    expect(computed.backgroundColor).toBe('rgb(1, 2, 3)');
    expect(computed.color).toBe('rgb(250, 251, 252)');
    expect(computed.colorScheme).toBe('light dark');
  });
});

describe('focus', () => {
  it('returns to the host element that had it', async () => {
    const hostButton = document.createElement('button');
    hostButton.textContent = 'host';
    document.body.append(hostButton);
    mount();
    hostButton.focus();
    await userEvent.keyboard(HOTKEY);
    await vi.waitFor(() => openDialog());
    expect(document.activeElement).toBe(host());
    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(hostButton);
    });
  });

  it('returns to a field inside a host shadow root', async () => {
    const widget = document.createElement('div');
    document.body.append(widget);
    const input = document.createElement('input');
    const root = widget.attachShadow({ mode: 'open' });
    root.append(input);
    const h = mount();
    input.focus();
    await h.open();
    h.close();
    expect(document.activeElement).toBe(widget);
    expect(root.activeElement).toBe(input);
  });
});

describe('layout', () => {
  it('anchors the popover beside the button, clear of it', async () => {
    await mount({ buttonPosition: 'bottom-right' }).open();
    const btn = button()?.getBoundingClientRect();
    const box = openDialog().getBoundingClientRect();
    if (!btn) throw new Error('no button');
    expect(box.bottom).toBeLessThanOrEqual(btn.top);
    expect(Math.round(box.right)).toBe(Math.round(btn.right));
  });

  it('anchors below a top-left button', async () => {
    await mount({ buttonPosition: 'top-left' }).open();
    const btn = button()?.getBoundingClientRect();
    const box = openDialog().getBoundingClientRect();
    if (!btn) throw new Error('no button');
    expect(box.top).toBeGreaterThanOrEqual(btn.bottom);
    expect(Math.round(box.left)).toBe(Math.round(btn.left));
  });

  it.each(['bottom-right', 'top-left'] as const)(
    'keeps a tall popover on screen from a %s button',
    async (buttonPosition) => {
      await page.viewport(480, 320);
      try {
        await mount({ buttonPosition }).open();
        const filler = document.createElement('div');
        filler.style.height = '2000px';
        openDialog().querySelector('.body')?.append(filler);
        const box = openDialog().getBoundingClientRect();
        const btn = button()?.getBoundingClientRect();
        if (!btn) throw new Error('no button');
        expect(box.top).toBeGreaterThanOrEqual(0);
        expect(box.bottom).toBeLessThanOrEqual(document.documentElement.clientHeight);
        // Still clear of the button it's anchored to.
        expect(box.bottom <= btn.top || box.top >= btn.bottom).toBe(true);
      } finally {
        await page.viewport(414, 896);
      }
    },
  );

  it('keeps the popover open on a click inside it', async () => {
    await mount().open();
    await userEvent.click(openDialog(), { position: { x: 10, y: 10 } });
    expect(dialog()?.open).toBe(true);
  });

  it('stacks the sheet above the button it covers', async () => {
    await mount({ surface: 'sheet' }).open();
    const btn = button()?.getBoundingClientRect();
    if (!btn) throw new Error('no button');
    const hit = shadow().elementFromPoint(btn.x + btn.width / 2, btn.y + btn.height / 2);
    expect(openDialog().contains(hit)).toBe(true);
  });

  it('keeps the sheet to the bottom 40% of the viewport, full width', async () => {
    await mount({ surface: 'sheet' }).open();
    const box = openDialog().getBoundingClientRect();
    const { clientWidth, clientHeight } = document.documentElement;
    expect(box.height).toBeLessThanOrEqual(clientHeight * 0.4 + 1);
    expect(Math.round(box.bottom)).toBe(clientHeight);
    expect(Math.round(box.width)).toBe(clientWidth);
  });

  it('docks the side panel to the right edge at full height', async () => {
    await mount({ surface: 'side' }).open();
    const box = openDialog().getBoundingClientRect();
    const { clientWidth, clientHeight } = document.documentElement;
    expect(Math.round(box.right)).toBe(clientWidth);
    expect(Math.round(box.height)).toBe(clientHeight);
  });

  it('defaults to a sheet when there is no button', async () => {
    await mount({ trigger: ['hotkey'] }).open();
    expect(openDialog().classList.contains('sheet')).toBe(true);
  });
});
