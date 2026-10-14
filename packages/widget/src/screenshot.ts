// The DOM screenshot: a lazy chunk, loaded when the widget opens. It shows
// the viewport as the user sees it, without the widget, with masked content
// painted over.
import { type Context, createContext, destroyContext, domToCanvas } from 'modern-screenshot';
import { type Capture, type Screenshot, encode } from './image.ts';
import { MASKED, maskRects, paintMasks } from './mask.ts';

/** Fonts and images the copy fetches give up after this long. */
const FETCH_TIMEOUT_MS = 3000;

const isElement = (node: Node): node is Element => node.nodeType === Node.ELEMENT_NODE;

/**
 * Empties a masked element in the copy, before it's drawn: no text, value,
 * children, background, image source, alt text or pseudo-elements (their
 * styles hang off a class). The paint over its box on the canvas is what
 * guarantees it. A same-origin iframe's document is copied in from the
 * frame's own document: it's emptied too, so frames come out blank, and
 * nothing inside one escapes the masking.
 */
function blank(node: Node): void {
  // A frame's nodes are from another realm: `instanceof` can't see them.
  if (isElement(node) && node.ownerDocument !== document && node.localName === 'html') {
    node.replaceChildren();
    return;
  }
  if (!(node instanceof HTMLElement || node instanceof SVGElement) || !node.matches(MASKED)) return;
  node.replaceChildren();
  for (const name of ['value', 'class', 'src', 'srcset', 'href', 'alt', 'poster']) {
    node.removeAttribute(name);
  }
  node.style.color = 'transparent';
  node.style.background = 'none';
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
    if (!paintMasks(canvas, rects, scale)) return undefined;
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
