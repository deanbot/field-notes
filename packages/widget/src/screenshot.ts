// The DOM screenshot: a lazy chunk, loaded when the widget opens. It shows
// the viewport as the user sees it, without the widget, with masked content
// painted over.
import { type Context, createContext, destroyContext, domToCanvas } from 'modern-screenshot';
import { type Capture, type Screenshot, encode } from './image.ts';
import { MASKED, maskRects, paintMasks } from './mask.ts';

/** Fonts and images the copy fetches give up after this long. */
const FETCH_TIMEOUT_MS = 3000;

/**
 * How long the copy waits for its style frame to load. Well within the
 * widget's wait for the copy (CLONE_WAIT_MS in mount.ts).
 */
const SANDBOX_TIMEOUT_MS = 400;

/** The library's own prefix for its frame: the copy leaves such frames out. */
const SANDBOX_ID = '__SANDBOX__';

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

interface Sandbox {
  readonly frame: HTMLIFrameElement;
  /** The frame once it's loaded, or undefined if it didn't in time. */
  readonly loaded: Promise<HTMLIFrameElement | undefined>;
}

/**
 * The hidden frame the library reads each element's default styles from,
 * made as the library makes it, but loaded before it's read from. The
 * library's own is read from at once (an empty quirks-mode document), or,
 * once the copy has waited on a video, while it loads: Firefox then warns in
 * the page's console, or the copy fails on its missing <body>. None without
 * a <body> in the page, where the library can't make one either.
 */
function loadSandbox(): Sandbox | undefined {
  // The DOM's types promise a <body>; a page can still have none.
  const body = document.body as HTMLElement | null;
  if (!body) return undefined;
  const frame = document.createElement('iframe');
  frame.id = `${SANDBOX_ID}${Math.random().toString(36).slice(2)}`;
  frame.width = frame.height = '0';
  frame.style.cssText = 'visibility:hidden;position:fixed';
  frame.srcdoc = '<!DOCTYPE html><meta charset="UTF-8"><title></title><body>';
  const loaded = new Promise<HTMLIFrameElement | undefined>((resolve) => {
    setTimeout(resolve, SANDBOX_TIMEOUT_MS);
    // In case an engine fires load for the empty document a frame starts with.
    frame.addEventListener('load', () => {
      if (frame.contentDocument?.URL === 'about:srcdoc') resolve(frame);
    });
  });
  body.append(frame);
  return { frame, loaded };
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
  const sandbox = loadSandbox();
  const stop = (): void => {
    if (context) destroyContext(context);
    sandbox?.frame.remove();
    copied();
  };

  const take = async (): Promise<Screenshot | undefined> => {
    // A stand-in node: the library would otherwise wait for every image on
    // the page to load (lazy ones never do) before copying anything.
    const making = createContext<HTMLElement>(document.createElement('div'), {
      scale,
      timeout: FETCH_TIMEOUT_MS,
      backgroundColor: pageBackground(),
      // Inner scrollers show their scrolled content. It moves the body by the
      // page's own scroll too, which onCloneNode undoes.
      features: { restoreScrollPosition: true },
      filter: (node) =>
        node !== exclude && !(node instanceof HTMLIFrameElement && node.id.startsWith(SANDBOX_ID)),
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
    // Without the frame in time, the library makes its own, as it would.
    const [made, frame] = await Promise.all([making, sandbox?.loaded]);
    context = made;
    if (stopped()) return undefined;
    if (frame) made.sandbox = frame;
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
