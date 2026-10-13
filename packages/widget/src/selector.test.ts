import * as finderModule from '@medv/finder';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_ELEMENT_TEXT, describeElement, isGenerated, selectorFor } from './selector.ts';

vi.mock('@medv/finder', { spy: true });

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function fixture(markup: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = markup;
  document.body.append(el);
  return el;
}

function find(selector: string): Element {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`no ${selector}`);
  return el;
}

/** Realistic pages: repeated rows and cards, few hooks, generated names. */
const PAGES = {
  'a product grid (CSS modules)': `
    <main class="Grid_root__x7Yz2">
      ${[1, 2, 3]
        .map(
          (n) => `<article class="Card_card__a1B2c">
            <h3 class="Card_title__q9W8e"><span>Plan ${String(n)}</span></h3>
            <p class="Card_price__z3X4v">$${String(n * 10)}</p>
            <button class="Button_primary__k5L6m"><svg viewBox="0 0 8 8"><path d="M0 0h8v8z"/></svg>Buy</button>
          </article>`,
        )
        .join('')}
    </main>`,
  'a data table': `
    <table class="table">
      <thead><tr><th>Name</th><th>Status</th><th></th></tr></thead>
      <tbody>
        ${[1, 2, 3, 4]
          .map(
            (n) =>
              `<tr><td>Row ${String(n)}</td><td><span class="badge">open</span></td><td><a href="/rows/${String(n)}">Edit</a></td></tr>`,
          )
          .join('')}
      </tbody>
    </table>`,
  'a form with generated ids (React useId)': `
    <form id="checkout">
      <label for=":r1:">Email</label><input id=":r1:" type="email" name="email">
      <label for=":r2:">Coupon</label><input id=":r2:" name="coupon">
      <div class="css-1x2y3z"><button type="submit" class="sc-bdVaJa">Place order</button></div>
    </form>`,
  'a nav with roles and labels': `
    <nav aria-label="Main"><ul role="list">
      <li><a href="/">Home</a></li><li><a href="/docs">Docs</a></li>
      <li><button aria-label="Open menu"><svg viewBox="0 0 8 8"><path d="M0 0h8"/></svg></button></li>
    </ul></nav>`,
};

describe('selectorFor', () => {
  it.each(Object.entries(PAGES))('finds every element again on %s', (_, markup) => {
    const page = fixture(markup);
    for (const el of page.querySelectorAll('*')) {
      expect([...document.querySelectorAll(selectorFor(el))]).toEqual([el]);
    }
  });

  it('uses a data-testid over hashed classes, and no hashed class at all', () => {
    fixture(`
      <ul class="List_list__p0O9i">
        <li class="Card_card__a1B2c"><button class="Button_primary__k5L6m">Buy</button></li>
        <li class="Card_card__a1B2c" data-testid="pro-plan"><button class="Button_primary__k5L6m">Buy</button></li>
      </ul>`);
    const card = find('[data-testid="pro-plan"]');
    expect(selectorFor(card)).toBe('[data-testid="pro-plan"]');
    const button = find('[data-testid="pro-plan"] button');
    const selector = selectorFor(button);
    expect(selector).toContain('[data-testid="pro-plan"]');
    expect(selector).not.toMatch(/__|_[a-z]+_/i);
    expect(document.querySelector(selector)).toBe(button);
  });

  it('prefers a test id to a hand-written class', () => {
    fixture(
      `<button class="primary" data-testid="buy">Buy</button><button class="primary">Sell</button>`,
    );
    expect(selectorFor(find('[data-testid="buy"]'))).toBe('[data-testid="buy"]');
  });

  it('takes a stable id first, then aria-label, then role, when unique', () => {
    fixture(`
      <section id="pricing"></section>
      <button aria-label="Close dialog">×</button><button>×</button>
      <div role="search"></div><div></div>`);
    expect(selectorFor(find('#pricing'))).toBe('#pricing');
    expect(selectorFor(find('[aria-label="Close dialog"]'))).toBe(
      'button[aria-label="Close\\ dialog"]',
    );
    expect(selectorFor(find('[role="search"]'))).toBe('div[role="search"]');
  });

  it('skips a hook that is not unique', () => {
    fixture(
      `<p><button data-testid="buy">A</button></p><div><button data-testid="buy">B</button></div>`,
    );
    const second = find('div > button');
    const selector = selectorFor(second);
    expect(selector).not.toBe('[data-testid="buy"]');
    expect(document.querySelector(selector)).toBe(second);
  });

  it('never uses a generated id', () => {
    fixture(`<input id=":r7:"><input id=":r8:">`);
    const second = find('[id=":r8:"]');
    const selector = selectorFor(second);
    expect(selector).not.toContain('r8');
    expect(document.querySelector(selector)).toBe(second);
  });

  it('falls back to a plain path when finder gives up', () => {
    vi.mocked(finderModule.finder).mockImplementationOnce(() => {
      throw new Error('Timeout');
    });
    fixture(`<p><b></b><b></b></p>`);
    const second = find('p > b:last-child');
    const selector = selectorFor(second);
    expect(selector).toMatch(
      /^html > body > div:nth-of-type\(\d+\) > p:nth-of-type\(1\) > b:nth-of-type\(2\)$/,
    );
    expect(document.querySelector(selector)).toBe(second);
  });

  it('falls back to a plain path when finder returns one that matches another element', () => {
    vi.mocked(finderModule.finder).mockReturnValueOnce('p');
    fixture(`<p></p><p></p>`);
    const second = find('p:last-child');
    expect(document.querySelector(selectorFor(second))).toBe(second);
  });
});

describe('isGenerated', () => {
  it.each([':r1:', '«r2»', 'ember123', 'x7Yz2', 'Card_title__x7Yz2', 'css-1x2y3z'])(
    '%s is generated',
    (name) => {
      expect(isGenerated(name)).toBe(true);
    },
  );
  it.each(['checkout', 'checkout2', 'item-42', 'main_nav', 'pricing-table', 'h1'])(
    '%s is not',
    (name) => {
      expect(isGenerated(name)).toBe(false);
    },
  );
});

describe('describeElement', () => {
  it('records the selector, tag, visible text, aria-label and viewport rect', () => {
    fixture(
      `<button aria-label=" Place order " style="position:fixed;left:10.4px;top:20.6px;width:100px;height:30px">
        Place
        <b>order</b><span hidden>secret</span>
      </button>`,
    );
    expect(describeElement(find('button'))).toEqual({
      selector: 'button[aria-label="\\ Place\\ order\\ "]',
      tag: 'button',
      text: 'Place order',
      ariaLabel: 'Place order',
      rect: { x: 10, y: 21, w: 100, h: 30 },
    });
  });

  it('caps the text', () => {
    fixture(`<p>${'word '.repeat(100)}</p>`);
    expect(describeElement(find('p')).text).toHaveLength(MAX_ELEMENT_TEXT);
  });

  it('keeps no text from masked content, inside or around it', () => {
    fixture(`<div class="card"><p data-field-notes-mask>4111 1111</p><span>visible</span></div>`);
    expect(describeElement(find('.card')).text).toBeUndefined();
    expect(describeElement(find('[data-field-notes-mask]')).text).toBeUndefined();
    expect(describeElement(find('.card span')).text).toBe('visible');
  });

  it('keeps no aria-label or name from masked content, in the selector either', () => {
    fixture(`
      <div data-field-notes-mask>
        <button aria-label="Email jane@example.com">✉</button><button aria-label="Call 555 0100">☎</button>
        <input name="jane@example.com"><input name="bob@example.com">
      </div>
      <section aria-label="Card ending 4242"><p data-field-notes-mask>4242</p></section>`);
    for (const el of document.querySelectorAll('button, input, section')) {
      const described = describeElement(el);
      expect(described).not.toHaveProperty('ariaLabel');
      expect(described.selector).not.toMatch(/jane|bob|555|4242/);
      expect(document.querySelector(described.selector)).toBe(el);
    }
  });

  it('leaves out text and aria-label when there are none', () => {
    fixture(`<svg><path d="M0 0h8"/></svg>`);
    const described = describeElement(find('path'));
    expect(described.tag).toBe('path');
    expect(described).not.toHaveProperty('text');
    expect(described).not.toHaveProperty('ariaLabel');
  });
});
