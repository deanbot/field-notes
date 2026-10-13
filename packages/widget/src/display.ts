// The display capture, for `screenshot: 'display'`: a lazy chunk. The browser
// asks the user what to share. Only this tab is kept, proven with Region
// Capture (Chromium), then cropped to the page, scaled like the DOM
// screenshot and masked. Anything else falls back to the DOM screenshot.
import { type Screenshot, draw, encode } from './image.ts';
import { maskRects, paintMasks } from './mask.ts';

/** How long to wait for the tab to send a frame after the widget is hidden. */
const FRAME_WAIT_MS = 1000;

// Region Capture isn't in TypeScript's DOM types.
interface RegionCapture {
  readonly CropTarget: { fromElement: (element: Element) => Promise<object> };
}
interface CroppableTrack extends MediaStreamTrack {
  cropTo: (target: object) => Promise<void>;
}
const hasRegionCapture = (scope: object): scope is RegionCapture => 'CropTarget' in scope;
const croppable = (track: MediaStreamTrack): track is CroppableTrack => 'cropTo' in track;

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** A video playing the stream, once a frame painted after this call is showing. */
async function playing(stream: MediaStream): Promise<HTMLVideoElement> {
  const video = document.createElement('video');
  video.muted = true;
  video.srcObject = stream;
  await video.play();
  // Two frames: the first may have been captured before the widget was hidden.
  // A page that doesn't change may send none, so don't wait for ever.
  for (let frames = 0; frames < 2; frames++) {
    await Promise.race([
      new Promise((resolve) => video.requestVideoFrameCallback(resolve)),
      wait(FRAME_WAIT_MS),
    ]);
  }
  return video;
}

/**
 * Asks the user to share this tab, and takes one frame of it without
 * `exclude` (the widget). `'dom'` when that can't be done: no Region Capture,
 * no user gesture to ask with, or the user shared something else. Undefined
 * if the user declined, or `signal` aborted meanwhile.
 */
export async function captureDisplay(
  exclude: HTMLElement,
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
  const visibility = exclude.style.visibility;
  try {
    const [track] = stream.getVideoTracks();
    if (aborted()) return undefined;
    if (!track || !croppable(track)) return 'dom';
    try {
      // Rejects unless the track is this tab.
      await track.cropTo(await window.CropTarget.fromElement(document.documentElement));
    } catch {
      return 'dom';
    }
    if (aborted()) return undefined;
    exclude.style.visibility = 'hidden';
    const video = await playing(stream);
    // As the DOM screenshot is scaled, so `element.rect` lines up the same way.
    const { clientWidth: width, clientHeight: height } = document.documentElement;
    const scale = Math.min(devicePixelRatio, 2);
    const canvas = draw(video, width * scale, height * scale);
    if (aborted() || !paintMasks(canvas, maskRects(), scale)) return undefined;
    return await encode(canvas);
  } finally {
    exclude.style.visibility = visibility;
    for (const track of stream.getTracks()) track.stop();
  }
}
