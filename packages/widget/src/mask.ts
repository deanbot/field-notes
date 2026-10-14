// What never shows in a screenshot, and painting over it.

/** Never in a screenshot: passwords, and whatever the page marks. */
export const MASKED = 'input[type="password"], [data-field-notes-mask]';

/** What masked areas are painted with. */
const MASK_FILL = '#888';

/** Every element in `root`, and in the open shadow roots within it. */
function within(root: ParentNode, found: Element[] = []): Element[] {
  for (const el of root.querySelectorAll('*')) {
    found.push(el);
    if (el.shadowRoot) within(el.shadowRoot, found);
  }
  return found;
}

const box = (el: Element): DOMRect => el.getBoundingClientRect();

/**
 * Where masked content is on screen: each masked element's box, its content's
 * (overflow) and each of its descendants' (positioned away from it). With
 * `frames`, every iframe's box too: a shot of real pixels, unlike the DOM
 * copy, shows what's in frames, and a cross-origin one can't be looked into.
 * Pseudo-element content drawn outside the element's box can't be measured.
 */
export function maskRects({ frames = false }: { frames?: boolean } = {}): DOMRect[] {
  const all = within(document);
  const rects = all
    .filter((el) => el.matches(MASKED))
    .flatMap((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return [box(el), range.getBoundingClientRect(), ...within(el).map(box)];
    });
  if (frames) rects.push(...all.filter((el) => el instanceof HTMLIFrameElement).map(box));
  return rects;
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
