// What a note records about a picked element. Part of the picker chunk.
import type { NoteElement } from '@field-notes/core/note';
import { className as wordLike, finder } from '@medv/finder';

/** Longest `text` kept, in characters. */
export const MAX_ELEMENT_TEXT = 200;

/** Attributes written for tests: the most stable hooks a page has. */
const TEST_ATTRS = ['data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-qa'];

/** Attributes a selector may use besides `id` and classes. */
const HOOK_ATTRS = new Set([...TEST_ATTRS, 'aria-label', 'role', 'name']);

const MASK = '[data-field-notes-mask]';

/** Attributes that hold what the page says, which masking hides. */
const WORDS = new Set(['aria-label', 'name']);

/** Inside masked content, or holding some. */
const masked = (el: Element): boolean =>
  el.closest(MASK) !== null || el.querySelector(MASK) !== null;

/**
 * Looks machine-made: React's `:r1:`, `ember123`, or a hash such as the
 * `x7Yz2` in `Card_title__x7Yz2` (letters and digits mixed, digits twice).
 */
export function isGenerated(name: string): boolean {
  if (/[:«»]|\d{3}/.test(name)) return true;
  return name
    .split(/[-_]/)
    .some((part) => part.length >= 5 && /[a-z]/i.test(part) && /\d+\D+\d/.test(part));
}

/** CSS-in-JS and CSS-modules classes: `css-1x2y3z`, `sc-bdVaJa`, `Card_title__x7Yz2`. */
const stableClass = (name: string): boolean =>
  wordLike(name) && !/^(css|sc|jsx|svelte|emotion)-/.test(name);

const stableId = (id: string): boolean => id.trim() === id && id !== '' && !isGenerated(id);

const hookAttr = (name: string, value: string): boolean =>
  HOOK_ATTRS.has(name) && value.trim() !== '' && value.length < 100;

/** Matches exactly `el` in the document. */
function resolvesTo(selector: string, el: Element): boolean {
  try {
    const found = document.querySelectorAll(selector);
    return found.length === 1 && found[0] === el;
  } catch {
    return false;
  }
}

/** The element's own stable hooks, best first. */
function hooks(el: Element, words: boolean): string[] {
  const tag = CSS.escape(el.localName);
  const found: string[] = [];
  if (stableId(el.id)) found.push(`#${CSS.escape(el.id)}`);
  for (const name of TEST_ATTRS) {
    const value = el.getAttribute(name);
    if (value) found.push(`[${name}="${CSS.escape(value)}"]`);
  }
  for (const name of words ? ['aria-label', 'role'] : ['role']) {
    const value = el.getAttribute(name);
    if (value && hookAttr(name, value)) found.push(`${tag}[${name}="${CSS.escape(value)}"]`);
  }
  return found;
}

/** `tag:nth-of-type()` steps from the root down: always unique, never pretty. */
function path(el: Element): string {
  const steps: string[] = [];
  for (let at: Element | null = el; at && at !== document.body; at = at.parentElement) {
    let index = 1;
    for (let sib = at.previousElementSibling; sib; sib = sib.previousElementSibling) {
      if (sib.localName === at.localName) index++;
    }
    steps.unshift(`${CSS.escape(at.localName)}:nth-of-type(${String(index)})`);
  }
  return ['html', 'body', ...steps].join(' > ');
}

/**
 * A selector that finds `el` again: its own `id`, test id, `aria-label` or
 * `role` when one is unique; otherwise the shortest unique path finder can
 * build from those and hand-written classes, keeping hashed or generated
 * names out. `:nth-child` only when nothing else tells it apart. No
 * `aria-label` or `name` when the element is masked.
 */
export function selectorFor(el: Element): string {
  const words = !masked(el);
  for (const hook of hooks(el, words)) if (resolvesTo(hook, el)) return hook;
  try {
    const found = finder(el, {
      root: document.documentElement,
      idName: stableId,
      className: stableClass,
      attr: (name, value) => hookAttr(name, value) && (words || !WORDS.has(name)),
      timeoutMs: 500,
    });
    if (resolvesTo(found, el)) return found;
  } catch {
    // Timed out or found nothing: fall through.
  }
  return path(el);
}

/** The text a reader sees in `el`, on one line. */
function visibleText(el: Element): string {
  const text = el instanceof HTMLElement ? el.innerText : el.textContent;
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_ELEMENT_TEXT);
}

/**
 * The note's `element`: rect in CSS pixels, relative to the viewport. No text
 * or `aria-label` when the element is masked.
 */
export function describeElement(el: Element): NoteElement {
  const box = el.getBoundingClientRect();
  const hidden = masked(el);
  const text = hidden ? '' : visibleText(el);
  const ariaLabel = hidden ? undefined : el.getAttribute('aria-label')?.trim();
  return {
    selector: selectorFor(el),
    tag: el.localName,
    ...(text ? { text } : {}),
    ...(ariaLabel ? { ariaLabel } : {}),
    rect: {
      x: Math.round(box.x),
      y: Math.round(box.y),
      w: Math.round(box.width),
      h: Math.round(box.height),
    },
  };
}
