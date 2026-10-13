// The DOM screenshot: a lazy chunk, loaded when the widget opens. It shows
// the viewport as the user sees it, without the widget, with masked content
// painted over.
import { type Context, createContext, destroyContext, domToCanvas } from 'modern-screenshot';

/** Never in a screenshot: passwords, and whatever the page marks. */
export const MASKED = 'input[type="password"], [data-field-notes-mask]';

/** PNG up to this size; above it, WebP where the browser can encode it. */
export const WEBP_ABOVE = 1_000_000;

/** Larger than this even so, the shot is taken again at half the size. */
export const MAX_BYTES = 8_000_000;

/** Fonts and images the copy fetches give up after this long. */
const FETCH_TIMEOUT_MS = 3000;

/** What masked areas are painted with. */
const MASK_FILL = '#888';

export interface Screenshot {
  readonly blob: Blob;
  /** `screenshot.png` or `screenshot.webp`. */
  readonly name: string;
}

export interface Capture {
  /** Settles once the page is copied: whatever covers it after that isn't in the shot. */
  readonly cloned: Promise<void>;
  /** The image; undefined if it failed (with a warning) or was cancelled. */
  readonly image: Promise<Screenshot | undefined>;
  readonly cancel: () => void;
}

/** Every masked element, in the document and in open shadow roots. */
function masked(root: Document | ShadowRoot, found: Element[] = []): Element[] {
  found.push(...root.querySelectorAll(MASKED));
  for (const el of root.querySelectorAll('*')) if (el.shadowRoot) masked(el.shadowRoot, found);
  return found;
}

/** Where masked content is on screen: each element's box, and its overflowing content. */
function maskRects(): DOMRect[] {
  return masked(document).flatMap((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return [el.getBoundingClientRect(), range.getBoundingClientRect()];
  });
}

/**
 * Empties a masked element in the copy, before it's drawn: no text, value,
 * children, background image or pseudo-elements (their styles hang off a
 * class). The paint over its box on the canvas is what guarantees it.
 */
function blank(node: Node): void {
  if (!(node instanceof HTMLElement || node instanceof SVGElement) || !node.matches(MASKED)) return;
  node.replaceChildren();
  node.removeAttribute('value');
  node.removeAttribute('class');
  node.style.color = 'transparent';
  node.style.backgroundImage = 'none';
}

const isTransparent = (color: string): boolean =>
  color === 'transparent' || /^rgba\(.*,\s*0\)$/.test(color);

/** What shows behind the page: the root's background, else the body's, else the canvas colour. */
function pageBackground(): string {
  for (const el of [document.documentElement, document.body]) {
    const color = getComputedStyle(el).backgroundColor;
    if (!isTransparent(color)) return color;
  }
  return 'Canvas';
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
}

function halve(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const half = document.createElement('canvas');
  half.width = Math.max(1, Math.floor(canvas.width / 2));
  half.height = Math.max(1, Math.floor(canvas.height / 2));
  half.getContext('2d')?.drawImage(canvas, 0, 0, half.width, half.height);
  return half;
}

/** PNG; WebP when the PNG is large and WebP is smaller; halved until it's under `MAX_BYTES`. */
export async function encode(canvas: HTMLCanvasElement): Promise<Screenshot | undefined> {
  for (let tries = 0; tries < 3; tries++, canvas = halve(canvas)) {
    let blob = await toBlob(canvas, 'image/png');
    if (!blob || blob.size > WEBP_ABOVE) {
      // A browser that can't encode WebP hands back a PNG instead.
      const webp = await toBlob(canvas, 'image/webp', 0.85);
      if (webp?.type === 'image/webp' && webp.size < (blob?.size ?? Infinity)) blob = webp;
    }
    if (blob && blob.size <= MAX_BYTES) {
      return { blob, name: blob.type === 'image/webp' ? 'screenshot.webp' : 'screenshot.png' };
    }
  }
  return undefined;
}

/**
 * Starts a screenshot of the viewport, at up to 2× (the device's pixel
 * ratio), leaving out `exclude` (the widget). The page is copied first,
 * mostly within this task; fonts and images are then embedded and the copy
 * drawn, which can take a while. Cross-origin images, iframes, tainted
 * canvases and videos come out blank, and some CSS isn't reproduced.
 */
export function captureScreenshot(exclude: Element): Capture {
  const root = document.documentElement;
  const { clientWidth: width, clientHeight: height } = root;
  const { scrollX: x, scrollY: y } = window;
  const scale = Math.min(devicePixelRatio, 2);
  // Masked areas when the copy starts and when it ends: both are painted.
  const rects = maskRects();
  let context: Context<HTMLElement> | undefined;
  let cancelled = false;
  // A function: TypeScript would narrow the variable across the awaits.
  const stopped = (): boolean => cancelled;
  let copied: () => void = () => undefined;
  const cloned = new Promise<void>((resolve) => {
    copied = resolve;
  });
  const stop = (): void => {
    if (context) destroyContext(context);
    copied();
  };

  const take = async (): Promise<Screenshot | undefined> => {
    // A stand-in node: the library would otherwise wait for every image on
    // the page to load (lazy ones never do) before copying anything.
    const made = await createContext<HTMLElement>(document.createElement('div'), {
      scale,
      timeout: FETCH_TIMEOUT_MS,
      backgroundColor: pageBackground(),
      // Inner scrollers show their scrolled content. It moves the body by the
      // page's own scroll too, which onCloneNode undoes.
      features: { restoreScrollPosition: true },
      filter: (node) =>
        node !== exclude &&
        !(node instanceof HTMLIFrameElement && node.id.startsWith('__SANDBOX__')),
      onCloneEachNode: blank,
      onCloneNode: (copy) => {
        if (!(copy instanceof HTMLElement)) return;
        // The page's scroll as an offset on <html>: fixed elements stay put,
        // sticky ones stick, and absolute ones move with the page. flow-root:
        // margins don't collapse through it, as they can't through a root.
        Object.assign(copy.style, {
          position: 'relative',
          display: 'flow-root',
          top: `${String(-y)}px`,
          left: `${String(-x)}px`,
        });
        const body = copy.querySelector('body');
        if (body) body.style.transform = getComputedStyle(document.body).transform;
        rects.push(...maskRects());
        copied();
      },
    });
    context = made;
    if (stopped()) return undefined;
    Object.assign(made, { node: root, width, height });
    const canvas = await domToCanvas(made);
    const paint = canvas.getContext('2d');
    if (!paint) return undefined;
    paint.fillStyle = MASK_FILL;
    for (const rect of rects) {
      paint.fillRect(rect.x * scale, rect.y * scale, rect.width * scale, rect.height * scale);
    }
    return stopped() ? undefined : encode(canvas);
  };

  const image = take().then(
    (shot) => (cancelled ? undefined : shot),
    (error: unknown) => {
      if (!cancelled)
        console.warn('[field-notes] the screenshot failed; the note goes without it.', error);
      return undefined;
    },
  );
  void image.finally(stop);
  return {
    cloned,
    image,
    cancel: () => {
      cancelled = true;
      stop();
    },
  };
}
