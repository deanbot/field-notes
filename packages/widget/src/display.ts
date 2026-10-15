// The display capture, for `screenshot: 'display'`: a lazy chunk. The browser
// asks the user what to share. Only this tab is kept, proven with Region
// Capture (Chromium), then cropped to the page, scaled like the DOM
// screenshot and masked. Anything else falls back to the DOM screenshot.
import { type Screenshot, draw, encode } from './image.ts';
import { maskRects, paintMasks } from './mask.ts';

/** How long to wait for the tab to send a frame after the widget is hidden. */
const FRAME_WAIT_MS = 1000;

/** How long the share may take to crop, and to send its first frame, before the DOM screenshot is taken instead. */
const START_WAIT_MS = 2000;

/** How long a video waits for its first frame before the tab is asked to send it again. */
const RESEND_AFTER_MS = 500;

// Region Capture isn't in TypeScript's DOM types.
interface RegionCapture {
  readonly CropTarget: { fromElement: (element: Element) => Promise<object> };
}
interface CroppableTrack extends MediaStreamTrack {
  cropTo: (target: object) => Promise<void>;
}
const hasRegionCapture = (scope: object): scope is RegionCapture =>
  Reflect.get(scope, 'CropTarget') !== undefined;
const croppable = (track: MediaStreamTrack): track is CroppableTrack => 'cropTo' in track;

// Nor is MediaStreamTrackProcessor (Chromium, like Region Capture).
interface FrameReader {
  read: () => Promise<{ value?: { close: () => void } }>;
  cancel: () => Promise<void>;
}
type TrackProcessor = new (init: { track: MediaStreamTrack }) => {
  readable: { getReader: () => FrameReader };
};

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Whether `promise` settles within `ms`; false if it doesn't, or rejects. */
const within = (promise: Promise<unknown>, ms: number): Promise<boolean> =>
  Promise.race([
    promise.then(
      () => true,
      () => false,
    ),
    wait(ms).then(() => false),
  ]);

/**
 * Changes one pixel of the page, imperceptibly, every frame until stopped.
 * A tab only sends frames when it repaints, and cropping and playing both
 * wait for one: on a page that doesn't change, they could wait for ever.
 */
function keepPainting(parent: ShadowRoot): () => void {
  const dot = document.createElement('div');
  dot.style.cssText =
    'position:fixed;left:0;top:0;width:1px;height:1px;background:#000;opacity:0;pointer-events:none';
  parent.append(dot);
  let frame = 0;
  const paint = (): void => {
    dot.style.opacity = dot.style.opacity === '0' ? '0.01' : '0';
    frame = requestAnimationFrame(paint);
  };
  frame = requestAnimationFrame(paint);
  return () => {
    cancelAnimationFrame(frame);
    dot.remove();
  };
}

/**
 * Reads a copy of `track` until stopped. A tab can leave a new video waiting
 * for a frame it has already sent; a new reader of the track has the tab
 * send its current frame again.
 */
function resend(track: MediaStreamTrack): () => void {
  const Processor = Reflect.get(window, 'MediaStreamTrackProcessor') as TrackProcessor | undefined;
  if (!Processor) return () => undefined;
  const copy = track.clone();
  const reader = new Processor({ track: copy }).readable.getReader();
  reader.read().then(
    ({ value }) => value?.close(),
    () => undefined,
  );
  return () => {
    reader.cancel().catch(() => undefined);
    copy.stop();
  };
}

/**
 * A video playing the stream, once a frame painted after this call is
 * showing. Undefined if the stream sends no frame in time.
 */
async function playing(stream: MediaStream): Promise<HTMLVideoElement | undefined> {
  const video = document.createElement('video');
  video.muted = true;
  video.srcObject = stream;
  const [track] = stream.getVideoTracks();
  let unread = (): void => undefined;
  const nudge = setTimeout(() => {
    if (track && video.readyState === HTMLMediaElement.HAVE_NOTHING) unread = resend(track);
  }, RESEND_AFTER_MS);
  try {
    if (!(await within(video.play(), START_WAIT_MS))) return undefined;
    // Two frames: the first may have been captured before the widget was hidden.
    // A page that doesn't change may send none, so don't wait for ever.
    for (let frames = 0; frames < 2; frames++) {
      await Promise.race([
        new Promise((resolve) => video.requestVideoFrameCallback(resolve)),
        wait(FRAME_WAIT_MS),
      ]);
    }
    return video;
  } finally {
    clearTimeout(nudge);
    unread();
  }
}

/**
 * Asks the user to share this tab, and takes one frame of it without what's
 * in `exclude` (the widget's shadow root). `'dom'` when that can't be done: no Region Capture,
 * no user gesture to ask with, the user shared something else, or the share
 * sent no frame in time. Undefined
 * if the user declined, or `signal` aborted meanwhile.
 */
export async function captureDisplay(
  exclude: ShadowRoot,
  signal: AbortSignal,
): Promise<Screenshot | 'dom' | undefined> {
  if (!hasRegionCapture(window)) return 'dom';
  // A function: TypeScript would narrow the property across the awaits.
  const aborted = (): boolean => signal.aborted;
  // Offer this tab first. Not all of these are in TypeScript's DOM types.
  const ask: DisplayMediaStreamOptions & Record<string, unknown> = {
    video: { displaySurface: 'browser' },
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
  };
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia(ask);
  } catch (error) {
    return error instanceof DOMException && error.name === 'NotAllowedError' ? undefined : 'dom';
  }
  // The page's view, without scrollbars, whichever side they're on: what a
  // fixed element at inset 0 covers. The crop is to it, not to <html>, which
  // is shorter than the view on a short page.
  const view = document.createElement('div');
  view.style.cssText = 'position:fixed;inset:0;pointer-events:none';
  const hidden = [...exclude.children]
    .filter((el) => el instanceof HTMLElement)
    .map((el) => ({
      el,
      value: el.style.getPropertyValue('display'),
      priority: el.style.getPropertyPriority('display'),
    }));
  let painting = (): void => undefined;
  try {
    const [track] = stream.getVideoTracks();
    if (aborted()) return undefined;
    if (!track || !croppable(track)) return 'dom';
    exclude.append(view);
    painting = keepPainting(exclude);
    // Rejects unless the track is this tab.
    const cropped = window.CropTarget.fromElement(view).then((target) => track.cropTo(target));
    if (!(await within(cropped, START_WAIT_MS))) return 'dom';
    if (aborted()) return undefined;
    // The widget's own elements; `important` beats their style sheet's.
    for (const { el } of hidden) el.style.setProperty('display', 'none', 'important');
    const video = await playing(stream);
    if (!video) return 'dom';
    // The view's size, which the crop is to, scaled as the DOM screenshot is,
    // so `element.rect` lines up the same way. Not <html>'s: in quirks mode,
    // it's as tall as the page.
    const { clientWidth: width, clientHeight: height } = view;
    const scale = Math.min(devicePixelRatio, 2);
    const canvas = draw(video, width * scale, height * scale);
    if (aborted() || !paintMasks(canvas, maskRects({ frames: true }), scale)) return undefined;
    return await encode(canvas);
  } finally {
    painting();
    for (const { el, value, priority } of hidden) el.style.setProperty('display', value, priority);
    view.remove();
    for (const track of stream.getTracks()) track.stop();
  }
}
