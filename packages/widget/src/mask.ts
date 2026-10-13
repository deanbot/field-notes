// What never shows in a screenshot, and painting over it.

/** Never in a screenshot: passwords, and whatever the page marks. */
export const MASKED = 'input[type="password"], [data-field-notes-mask]';

/** What masked areas are painted with. */
const MASK_FILL = '#888';

/** Every masked element, in the document and in open shadow roots. */
function masked(root: Document | ShadowRoot, found: Element[] = []): Element[] {
  found.push(...root.querySelectorAll(MASKED));
  for (const el of root.querySelectorAll('*')) if (el.shadowRoot) masked(el.shadowRoot, found);
  return found;
}

/** Where masked content is on screen: each element's box, and its overflowing content. */
export function maskRects(): DOMRect[] {
  return masked(document).flatMap((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return [el.getBoundingClientRect(), range.getBoundingClientRect()];
  });
}

/**
 * Paints over `rects` (CSS pixels from the viewport's corner) on a canvas
 * drawn at `scale`. False if the canvas can't be painted on.
 */
export function paintMasks(canvas: HTMLCanvasElement, rects: DOMRect[], scale: number): boolean {
  const paint = canvas.getContext('2d');
  if (!paint) return false;
  paint.fillStyle = MASK_FILL;
  // Whole device pixels: a partly covered one would show a blend.
  for (const { left, top, right, bottom } of rects) {
    const x = Math.floor(left * scale);
    const y = Math.floor(top * scale);
    paint.fillRect(x, y, Math.ceil(right * scale) - x, Math.ceil(bottom * scale) - y);
  }
  return true;
}
