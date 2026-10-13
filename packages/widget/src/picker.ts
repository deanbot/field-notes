// The element picker: a lazy chunk, loaded on the first "Pick element". A
// transparent layer in the top layer takes the pointer, so the page under it
// never sees the click, and shows what will be picked before it is.
import type { NoteElement } from '@field-notes/core/note';
import { describeElement } from './selector.ts';

const css = `
.picker {
  --_accent: var(--field-notes-accent, light-dark(#0969da, #4493f8));
  color-scheme: light dark;
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  max-width: none;
  max-height: none;
  margin: 0;
  padding: 0;
  border: 0;
  overflow: hidden;
  background: transparent;
  cursor: crosshair;
  font: 12px/1.4 var(--field-notes-font, system-ui, sans-serif);
}
.picker > * { position: fixed; pointer-events: none; box-sizing: border-box; }
.box { border: 2px solid var(--_accent); background: rgb(9 105 218 / 0.12); }
.tag, .help {
  padding: 2px 8px;
  border-radius: 4px;
  color: #fff;
  background: #1a1a1a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tag { max-width: min(480px, calc(100vw - 16px)); }
.help { top: 8px; left: 50%; transform: translateX(-50%); }
`;

let sheet: CSSStyleSheet | undefined;

/** `tag “text”`, short, for the label and the form. */
function summarize(el: Element): string {
  const text = (el instanceof HTMLElement ? el.innerText : '').replace(/\s+/g, ' ').trim();
  return text
    ? `${el.localName} “${text.length > 40 ? `${text.slice(0, 39)}…` : text}”`
    : el.localName;
}

export interface Picked {
  readonly element: NoteElement;
  /** `tag “text”`, as the picker labelled it. */
  readonly label: string;
}

/**
 * Lets the user point at a page element. Resolves with what the note records,
 * or undefined when cancelled (Esc) or aborted. Pointer aims and clicks, and a plain wheel scrolls; Alt+wheel
 * or ↑/↓ climb to the parent and back down; ←/→ move between siblings; Enter
 * picks. Shadow roots, iframes and canvases are picked whole, as the host
 * element: nothing inside them is guessed at.
 */
export function pickElement(root: ShadowRoot, signal: AbortSignal): Promise<Picked | undefined> {
  if (!sheet) {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
  }
  if (!root.adoptedStyleSheets.includes(sheet)) {
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
  }
  const layer = document.createElement('div');
  layer.className = 'picker';
  layer.popover = 'manual';
  const box = document.createElement('div');
  box.className = 'box';
  const tag = document.createElement('div');
  tag.className = 'tag';
  tag.setAttribute('role', 'status');
  const help = document.createElement('div');
  help.className = 'help';
  help.textContent = 'Click or Enter to pick · ↑ ↓ parent / child · Esc to cancel';
  layer.append(box, tag, help);
  root.append(layer);
  layer.showPopover();

  // Opened from a focused page element (the dialog hands focus back to it)?
  // Then the keyboard starts there.
  const focused = document.activeElement;
  const usable = (el: Element): boolean => el !== root.host && el !== document.documentElement;

  /** Where the pointer last aimed, before any climbing. */
  let aimed: Element | undefined;
  /** The way back down after climbing. */
  let trail: Element[] = [];
  let current: Element | undefined;
  /** A press landed on what was already shown, so its click picks. */
  let armed = false;

  const draw = (): void => {
    box.hidden = tag.hidden = !current;
    if (!current) return;
    const rect = current.getBoundingClientRect();
    Object.assign(box.style, {
      left: `${String(rect.left)}px`,
      top: `${String(rect.top)}px`,
      width: `${String(rect.width)}px`,
      height: `${String(rect.height)}px`,
    });
    tag.textContent = summarize(current);
    const above = rect.top >= 24;
    tag.style.top = `${String(Math.max(0, above ? rect.top - 22 : rect.bottom + 2))}px`;
    tag.style.left = `${String(Math.min(Math.max(0, rect.left), innerWidth - tag.offsetWidth))}px`;
  };
  draw();
  const show = (el: Element | undefined, keepTrail = false): void => {
    if (!keepTrail) trail = [];
    current = el;
    draw();
  };
  /** A keyboard or Alt+wheel move: nothing picked may be out of sight. */
  const move = (el: Element | undefined, keepTrail = false): void => {
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    show(el, keepTrail);
  };

  /** The page element under a point; none over the widget's own UI. */
  const hit = (x: number, y: number): Element | undefined => {
    if (root.elementsFromPoint(x, y).some((el) => el !== layer && root.contains(el))) return;
    return document.elementsFromPoint(x, y).find(usable);
  };
  const aim = (event: PointerEvent): boolean => {
    const el = hit(event.clientX, event.clientY);
    if (el === aimed) return false;
    aimed = el;
    show(el);
    return true;
  };

  const start = (): Element | undefined =>
    focused && usable(focused) && focused !== document.body
      ? focused
      : hit(innerWidth / 2, innerHeight / 2);
  const up = (): void => {
    const parent = current?.parentElement;
    if (!current || !parent || !usable(parent)) return;
    trail.push(current);
    move(parent, true);
  };
  const down = (): void => {
    let child = trail.pop() ?? current?.firstElementChild;
    while (child && !usable(child)) child = child.nextElementSibling;
    if (child) move(child, true);
  };
  const sideways = (next: boolean): void => {
    let el = next ? current?.nextElementSibling : current?.previousElementSibling;
    while (el && !usable(el)) el = next ? el.nextElementSibling : el.previousElementSibling;
    if (el) move(el);
  };

  /**
   * A plain wheel: the layer takes it, so the page never scrolls by itself.
   * Scroll what it would have: the nearest box under the pointer with room to
   * go that way, else the page.
   */
  const scroll = (event: WheelEvent): void => {
    let { deltaX: dx, deltaY: dy } = event;
    if (event.shiftKey && !dx) [dx, dy] = [dy, 0];
    const room = (overflow: string, delta: number, at: number, size: number, all: number) =>
      /auto|scroll|overlay/.test(overflow) &&
      (delta < 0 ? at > 0 : delta > 0 && at + size < all - 1);
    let el = hit(event.clientX, event.clientY);
    while (el) {
      const { overflowX, overflowY } = getComputedStyle(el);
      if (
        room(overflowY, dy, el.scrollTop, el.clientHeight, el.scrollHeight) ||
        room(overflowX, dx, el.scrollLeft, el.clientWidth, el.scrollWidth)
      ) {
        break;
      }
      el = el.parentElement ?? undefined;
    }
    // deltaMode: 0 pixels, 1 lines, 2 pages.
    const [w, h] =
      event.deltaMode === 2
        ? el
          ? [el.clientWidth, el.clientHeight]
          : [innerWidth, innerHeight]
        : event.deltaMode
          ? [16, 16]
          : [1, 1];
    (el ?? window).scrollBy({ left: dx * w, top: dy * h, behavior: 'instant' });
  };

  return new Promise((resolve) => {
    const done = (el: Element | undefined): void => {
      const picked = el && { element: describeElement(el), label: summarize(el) };
      listeners.abort();
      layer.remove();
      resolve(picked);
    };
    const listeners = new AbortController();
    const on = { signal: listeners.signal };
    const capture = { ...on, capture: true };

    // Pointer events are taken on the window, first, and go no further. The
    // layer usually receives them, but while a host's modal dialog is open
    // the layer is inert, and they target the page itself.
    const swallow = (event: Event): void => {
      event.preventDefault(); // no focus change, text selection or click action
      event.stopImmediatePropagation();
    };
    for (const type of ['pointerup', 'mousedown', 'mouseup', 'dblclick', 'auxclick']) {
      addEventListener(type, swallow, capture);
    }
    addEventListener(
      'pointermove',
      (event) => {
        event.stopImmediatePropagation();
        aim(event);
      },
      capture,
    );
    addEventListener(
      'pointerdown',
      (event) => {
        swallow(event);
        // A touch has no hover: its first tap aims, and only a tap on what's
        // already shown picks.
        armed = !aim(event);
      },
      capture,
    );
    addEventListener(
      'click',
      (event) => {
        swallow(event);
        if (armed && current) done(current);
        armed = false;
      },
      capture,
    );
    addEventListener(
      'wheel',
      (event) => {
        if (event.ctrlKey) return; // zooms
        swallow(event);
        if (!event.altKey) scroll(event);
        else if (event.deltaY < 0) up();
        else if (event.deltaY > 0) down();
      },
      { ...capture, passive: false },
    );
    // Keys too: a host's own key handlers or focus trap mustn't see these
    // while picking, whatever has focus.
    addEventListener(
      'keydown',
      (event) => {
        const actions: Record<string, () => void> = {
          Escape: () => {
            done(undefined);
          },
          Enter: () => {
            if (current) done(current);
          },
          ArrowUp: up,
          ArrowDown: down,
          ArrowLeft: () => {
            sideways(false);
          },
          ArrowRight: () => {
            sideways(true);
          },
        };
        const action = actions[event.key];
        if (!action || event.isComposing) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (current || event.key === 'Escape') action();
        else move(start());
      },
      capture,
    );
    addEventListener('scroll', draw, { ...capture, passive: true });
    addEventListener('resize', draw, on);
    signal.addEventListener(
      'abort',
      () => {
        done(undefined);
      },
      on,
    );
    if (signal.aborted) done(undefined);
  });
}
