import type { Note } from '@field-notes/core/note';
import { userEvent } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deliver } from './deliver.ts';
import { TAG_NAME } from './element.ts';
import { type FieldNotesHandle, type FieldNotesOptions, mountFieldNotes } from './mount.ts';

vi.mock('./deliver.ts', () => ({ deliver: vi.fn(() => Promise.resolve()) }));

const delivered = vi.mocked(deliver);
let handle: FieldNotesHandle | undefined;

function mount(options: FieldNotesOptions = {}): FieldNotesHandle {
  handle = mountFieldNotes({ enabled: true, screenshot: 'off', ...options });
  return handle;
}

beforeEach(() => {
  localStorage.clear();
  delivered.mockClear();
});

afterEach(() => {
  handle?.unmount();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function shadow(): ShadowRoot {
  const root = document.querySelector(TAG_NAME)?.shadowRoot;
  if (!root) throw new Error('not mounted');
  return root;
}
const dialog = (): HTMLDialogElement | null => shadow().querySelector('dialog');
const layer = (): HTMLElement | null => shadow().querySelector('.picker');
function picking(): HTMLElement {
  const el = layer();
  if (!el) throw new Error('not picking');
  return el;
}
const label = (): string => shadow().querySelector('.picker .tag')?.textContent ?? '';
const picked = (): string => shadow().querySelector('.picked')?.textContent.trim() ?? '';
function textarea(): HTMLTextAreaElement {
  const el = shadow().querySelector('textarea');
  if (!el) throw new Error('no textarea');
  return el;
}
function button(text: string): HTMLButtonElement {
  const found = [...shadow().querySelectorAll('button')].find(
    (el) => el.textContent.trim() === text || el.ariaLabel === text,
  );
  if (!found) throw new Error(`no ${text} button`);
  return found;
}

function find(selector: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`no ${selector}`);
  return el;
}

/** A page to pick from, under the widget. */
function page(markup: string): void {
  const el = document.createElement('div');
  el.innerHTML = markup;
  document.body.prepend(el);
}

const CARDS = `
  <section class="plans" style="padding:24px">
    <ul class="rows" style="list-style:none;margin:0;padding:0">
      <li class="row">
        <article class="card" data-testid="pro" style="padding:16px;border:1px solid">
          <div class="head"><h3 class="title"><a href="#pro" class="link">Pro <span class="name">plan</span></a></h3></div>
          <p class="price">$10</p>
        </article>
      </li>
      <li class="row"><article class="card" data-testid="team" style="padding:16px">Team</article></li>
    </ul>
  </section>`;

async function startPicking(): Promise<void> {
  await userEvent.click(shadow().querySelector('.picked') ?? button('Pick element'));
  await vi.waitFor(picking);
}

function centre(el: Element): { clientX: number; clientY: number } {
  const rect = el.getBoundingClientRect();
  return { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
}

/** The pointer, at `el`'s centre, as the layer above the page sees it. */
function pointer(type: string, el: Element, init: PointerEventInit & WheelEventInit = {}): void {
  const target = picking();
  const Event = type === 'click' ? MouseEvent : type === 'wheel' ? WheelEvent : PointerEvent;
  target.dispatchEvent(
    new Event(type, {
      bubbles: true,
      composed: true,
      pointerType: 'mouse',
      ...centre(el),
      ...init,
    }),
  );
}
const aim = (el: Element): void => {
  pointer('pointermove', el);
};
/** A mouse click comes after the pointer moved there; a touch doesn't. */
function tap(el: Element, pointerType = 'mouse'): void {
  if (pointerType === 'mouse') aim(el);
  pointer('pointerdown', el, { pointerType });
  pointer('pointerup', el, { pointerType });
  pointer('click', el);
}

/** Where the highlight is drawn. */
function highlight(): DOMRect {
  const box = shadow().querySelector<HTMLElement>('.picker .box');
  if (!box || box.hidden) throw new Error('nothing highlighted');
  return box.getBoundingClientRect();
}

async function submitted(): Promise<Note> {
  if (!textarea().value) await userEvent.type(textarea(), 'A note');
  await userEvent.click(button('Add note'));
  await vi.waitFor(() => {
    expect(delivered).toHaveBeenCalledOnce();
  });
  const note = delivered.mock.calls[0]?.[0];
  if (!note) throw new Error('nothing delivered');
  return note;
}

async function back(): Promise<void> {
  await vi.waitFor(() => {
    expect(layer()).toBeNull();
    expect(dialog()?.open).toBe(true);
  });
}

describe('the element picker', () => {
  it('collapses the panel, records what was highlighted, and brings the form back as it was', async () => {
    page(CARDS);
    await mount({ surface: 'side' }).open();
    await userEvent.type(textarea(), 'Price looks off');
    await userEvent.click(shadow().querySelector('input[value="bug"]') ?? button('bug'));
    await startPicking();
    expect(dialog()?.open).toBe(false);

    const price = find('.price');
    aim(price);
    expect(highlight().toJSON()).toEqual(price.getBoundingClientRect().toJSON());
    expect(label()).toBe('p “$10”');
    tap(price);
    await back();

    expect(textarea().value).toBe('Price looks off');
    expect(shadow().activeElement).toBe(textarea());
    expect(picked()).toBe('p “$10”');
    expect(button('Picked p “$10”. Pick again')).toBeTruthy();
    const note = await submitted();
    expect(note.type).toBe('bug');
    const rect = price.getBoundingClientRect();
    expect(note.element).toEqual({
      selector: '.price',
      tag: 'p',
      text: '$10',
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      },
    });
    expect(document.querySelector(note.element?.selector ?? '')).toBe(price);
  });

  it("picks without the page seeing the click, and Esc cancels without the host's Esc", async () => {
    page(`<button class="buy" style="padding:20px">Buy</button>`);
    const clicked = vi.fn();
    const keyed = vi.fn();
    find('.buy').addEventListener('click', clicked);
    document.addEventListener('keydown', keyed);
    await mount().open();
    await startPicking();
    tap(find('.buy'));
    await back();
    expect(clicked).not.toHaveBeenCalled();

    await startPicking();
    aim(find('.buy'));
    await userEvent.keyboard('{Escape}');
    await back();
    expect(keyed).not.toHaveBeenCalled();
    expect(picked()).toBe('button “Buy”'); // the earlier pick stays
    document.removeEventListener('keydown', keyed);
  });

  it('removes a pick', async () => {
    page(CARDS);
    await mount().open();
    await startPicking();
    tap(find('.price'));
    await back();
    await userEvent.click(button('Remove picked element'));
    expect(picked()).toBe('');
    expect((await submitted()).element).toBeUndefined();
  });

  it("never picks the widget's own UI", async () => {
    page(`<div style="position:fixed;inset:0;background:#eee"></div>`);
    await mount({ trigger: ['button'], surface: 'sheet' }).open();
    await startPicking();
    const trigger = shadow().querySelector('button.trigger');
    if (!trigger) throw new Error('no trigger button');
    aim(trigger);
    expect(() => highlight()).toThrow('nothing highlighted');
    tap(trigger);
    expect(layer()).not.toBeNull();
    aim(picking()); // anywhere else: the page behind
    expect(label()).toBe('div');
  });

  it('shows a transparent overlay above a button as the overlay', async () => {
    page(`
      <div style="position:relative;width:200px;height:60px">
        <button class="under" style="width:100%;height:100%">Save</button>
        <div class="shield" style="position:absolute;inset:0"></div>
      </div>`);
    await mount().open();
    await startPicking();
    aim(find('.under'));
    expect(label()).toBe('div');
    expect(highlight().toJSON()).toEqual(find('.shield').getBoundingClientRect().toJSON());
    tap(find('.under'));
    await back();
    const note = await submitted();
    expect(document.querySelector(note.element?.selector ?? '')).toBe(find('.shield'));
  });

  it('reaches the card from a nested link with the keyboard alone', async () => {
    page(CARDS);
    mount();
    find('.link').focus();
    await userEvent.keyboard('{Alt>}{Shift>}F{/Shift}{/Alt}');
    await vi.waitFor(() => {
      expect(dialog()?.open).toBe(true);
    });
    await userEvent.type(textarea(), 'Wrong card');
    // Tab gets there too, but WebKit's Tab skips buttons unless the user
    // turned that on.
    button('Pick element').focus();
    await userEvent.keyboard('{Enter}');
    await vi.waitFor(() => {
      expect(layer()).not.toBeNull();
    });
    await userEvent.keyboard('{ArrowUp}'); // starts at the focused link
    expect(label()).toBe('a “Pro plan”');
    await userEvent.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}');
    expect(label()).toBe('article “Pro plan $10”');
    await userEvent.keyboard('{Enter}');
    await back();
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await vi.waitFor(() => {
      expect(delivered).toHaveBeenCalledOnce();
    });
    expect(delivered.mock.calls[0]?.[0].element?.selector).toBe('[data-testid="pro"]');
  });

  it('climbs with Alt+wheel, comes back down the same way, and moves between siblings', async () => {
    page(CARDS);
    await mount().open();
    await startPicking();
    const name = find('.name');
    aim(name);
    expect(label()).toBe('span “plan”');
    pointer('wheel', name, { altKey: true, deltaY: -1 });
    pointer('wheel', name, { altKey: true, deltaY: -1 });
    expect(label()).toBe('h3 “Pro plan”');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(label()).toBe('span “plan”');
    await userEvent.keyboard('{ArrowDown}'); // no way back left, and no child
    expect(label()).toBe('span “plan”');
    await userEvent.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}{ArrowRight}');
    expect(label()).toBe('p “$10”');
    await userEvent.keyboard('{ArrowLeft}{ArrowDown}{ArrowDown}');
    expect(label()).toBe('a “Pro plan”'); // the first child, from where the trail ended
    pointer('wheel', name, { deltaY: -1 }); // a plain wheel only scrolls
    expect(label()).toBe('a “Pro plan”');
  });

  it('brings what the keyboard moves to into view', async () => {
    page(`<p class="first">first</p><div style="height:3000px"></div><p class="last">last</p>`);
    await mount().open();
    await startPicking();
    aim(find('.first'));
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    expect(label()).toBe('p “last”');
    const last = find('.last').getBoundingClientRect();
    expect(last.bottom).toBeLessThanOrEqual(innerHeight);
    expect(highlight().toJSON()).toEqual(last.toJSON());
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(find('.first').getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
    scrollTo(0, 0);
  });

  it('scrolls the box under the pointer with a plain wheel, then the page past its end', async () => {
    page(`
      <div class="inner" style="height:100px;overflow:auto"><div style="height:200px">inner</div></div>
      <div style="height:3000px"></div>`);
    await mount().open();
    await startPicking();
    const inner = find('.inner');
    pointer('wheel', inner, { deltaY: 2, deltaMode: WheelEvent.DOM_DELTA_LINE });
    expect(inner.scrollTop).toBe(32);
    expect(scrollY).toBe(0);
    pointer('wheel', inner, { deltaY: 1, deltaMode: WheelEvent.DOM_DELTA_PAGE });
    expect(inner.scrollTop).toBe(100);
    pointer('wheel', inner, { deltaY: 40 }); // at its end: the page scrolls
    expect(scrollY).toBe(40);
    pointer('wheel', inner, { deltaY: 40, shiftKey: true }); // sideways, and nothing is wider
    expect(scrollY).toBe(40);
    scrollTo(0, 0);
  });

  it("picks the host of a shadow root, an iframe or a canvas, not what's inside", async () => {
    page(`
      <div class="host" style="display:block;width:120px;height:40px"></div>
      <iframe class="frame" style="width:120px;height:40px" srcdoc="<button>in frame</button>"></iframe>
      <canvas class="paint" width="120" height="40"></canvas>`);
    const host = find('.host');
    host.attachShadow({ mode: 'open' }).innerHTML =
      '<button style="width:120px;height:40px">inside</button>';
    await mount().open();
    await startPicking();
    aim(host);
    expect(label()).toBe('div');
    aim(find('.frame'));
    expect(label()).toBe('iframe');
    aim(find('.paint'));
    expect(label()).toBe('canvas');
    await userEvent.keyboard('{ArrowDown}'); // a canvas has no children to climb into
    expect(label()).toBe('canvas');
  });

  it('needs a second tap on touch: the first only aims', async () => {
    page(CARDS);
    await mount().open();
    await startPicking();
    tap(find('.price'), 'touch');
    expect(label()).toBe('p “$10”');
    expect(layer()).not.toBeNull();
    tap(find('.price'), 'touch');
    await back();
    expect(picked()).toBe('p “$10”');
  });

  it('follows the page when it scrolls', async () => {
    page(`<p class="target" style="margin-top:100px">here</p><div style="height:3000px"></div>`);
    await mount().open();
    await startPicking();
    const target = find('.target');
    aim(target);
    const before = highlight().top;
    scrollBy(0, 50);
    await vi.waitFor(() => {
      expect(highlight().top).toBe(before - 50);
    });
    scrollTo(0, 0);
  });

  it('stops picking when the panel closes', async () => {
    page(CARDS);
    const h = mount();
    await h.open();
    await startPicking();
    h.close();
    await vi.waitFor(() => {
      expect(layer()).toBeNull();
    });
    expect(dialog()).toBeNull();
    await h.open();
    expect(dialog()?.open).toBe(true);
    expect(picked()).toBe('');
  });
});

describe('the element picker, with a real pointer', () => {
  it('takes the click itself: the page under it never sees it', async () => {
    page(`<button class="buy" style="padding:20px">Buy</button>`);
    const clicked = vi.fn();
    find('.buy').addEventListener('click', clicked);
    await mount().open();
    await startPicking();
    await userEvent.hover(find('.buy'), { force: true });
    expect(highlight().toJSON()).toEqual(find('.buy').getBoundingClientRect().toJSON());
    await userEvent.click(find('.buy'), { force: true });
    await back();
    expect(clicked).not.toHaveBeenCalled();
    expect(picked()).toBe('button “Buy”');
  });

  it("picks inside the host's own modal dialog, which stays untouched", async () => {
    page(`<dialog class="checkout"><button class="delete">Delete</button></dialog>`);
    const checkout = find('.checkout') as HTMLDialogElement;
    checkout.showModal();
    const deleted = vi.fn();
    find('.delete').addEventListener('click', deleted);
    await mount().open();
    await startPicking();
    await userEvent.hover(find('.delete'), { force: true });
    expect(label()).toBe('button “Delete”');
    await userEvent.click(find('.delete'), { force: true });
    await back();
    expect(deleted).not.toHaveBeenCalled();
    expect(picked()).toBe('button “Delete”');
    await startPicking();
    await userEvent.keyboard('{Escape}');
    await back();
    expect(checkout.open).toBe(true);
  });

  it('scrolls the page with a plain wheel, but not with Alt+wheel', async () => {
    page(`<div style="height:3000px"></div>`);
    await mount().open();
    await startPicking();
    // The wheel turns over the middle of the layer, wherever that is.
    await userEvent.keyboard('{Alt>}');
    await userEvent.wheel(picking(), { delta: { y: -100 } });
    await userEvent.keyboard('{/Alt}');
    expect(scrollY).toBe(0);
    await userEvent.wheel(picking(), { delta: { y: 200 } });
    await vi.waitFor(() => {
      expect(scrollY).toBeGreaterThan(0);
    });
    scrollTo(0, 0);
  });

  it('scrolls an app shell, whose page never scrolls, with a plain wheel', async () => {
    page(`<main class="shell" style="position:fixed;inset:0;overflow:auto">
      <div style="height:3000px"></div></main>`);
    await mount().open();
    await startPicking();
    await userEvent.wheel(picking(), { delta: { y: 200 } });
    await vi.waitFor(() => {
      expect(find('.shell').scrollTop).toBeGreaterThan(0);
    });
  });
});
