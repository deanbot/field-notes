import { afterEach, describe, expect, it } from 'vitest';
import { isEditableTarget } from './keyboard.ts';

function make(html: string): Element {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.append(host);
  const el = host.firstElementChild;
  if (!el) throw new Error('fixture produced no element');
  return el;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('isEditableTarget', () => {
  it.each([
    ['<input type="text">', true],
    ['<input>', true],
    ['<input type="search">', true],
    ['<textarea></textarea>', true],
    ['<select><option>a</option></select>', true],
    ['<div contenteditable="true"></div>', true],
    ['<input type="checkbox">', false],
    ['<input type="button">', false],
    ['<input readonly>', false],
    ['<textarea disabled></textarea>', false],
    ['<button>go</button>', false],
    ['<div></div>', false],
  ])('%s → %s', (html, expected) => {
    expect(isEditableTarget(make(html))).toBe(expected);
  });

  it('treats children of contenteditable as editable', () => {
    const root = make('<div contenteditable="true"><span>text</span></div>');
    expect(isEditableTarget(root.querySelector('span'))).toBe(true);
  });

  it('rejects non-elements', () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(window)).toBe(false);
  });
});
