// A stand-in for a shared tab, for the display capture's tests.
import { expect, vi } from 'vitest';
import type { Pixels } from './test-pixels.ts';

/**
 * Has `getDisplayMedia` share a canvas the size of the view, as this tab
 * would: blue, a red square at (40, 30) and a green strip along the bottom
 * 20px. Region Capture is faked too. Undo with `vi.restoreAllMocks()` and
 * `vi.unstubAllGlobals()`.
 */
export function shareTab(): void {
  vi.stubGlobal('CropTarget', { fromElement: () => Promise.resolve({}) });
  const scale = Math.min(devicePixelRatio, 2);
  const { clientWidth, clientHeight } = document.scrollingElement ?? document.documentElement;
  const tab = document.createElement('canvas');
  tab.width = clientWidth * scale;
  tab.height = clientHeight * scale;
  const paint = tab.getContext('2d');
  let flip = false;
  const draw = (): void => {
    if (!paint) return;
    paint.fillStyle = 'rgb(0, 0, 255)';
    paint.fillRect(0, 0, tab.width, tab.height);
    paint.fillStyle = 'rgb(255, 0, 0)';
    paint.fillRect(40 * scale, 30 * scale, 20 * scale, 20 * scale);
    paint.fillStyle = 'rgb(0, 255, 0)';
    paint.fillRect(0, (clientHeight - 20) * scale, tab.width, 20 * scale);
    // Some engines only send a frame once the canvas changes.
    flip = !flip;
    paint.fillStyle = flip ? 'rgb(0, 0, 254)' : 'rgb(0, 0, 255)';
    paint.fillRect(tab.width - 1, 0, 1, 1);
  };
  draw();
  const timer = setInterval(draw, 16);
  vi.spyOn(navigator.mediaDevices, 'getDisplayMedia').mockImplementation(() => {
    const stream = tab.captureStream();
    for (const track of stream.getVideoTracks()) {
      Object.assign(track, { cropTo: () => Promise.resolve() });
    }
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      clearInterval(timer);
    });
    return Promise.resolve(stream);
  });
}

/** Checks a capture of `shareTab()`'s tab is the view's size, each point where it is on screen. */
export function expectView(seen: Pixels): void {
  const { clientWidth, clientHeight } = document.scrollingElement ?? document.documentElement;
  const blue = '0,0,255';
  expect({
    size: [seen.width, seen.height],
    square: seen.at(50, 40),
    besideSquare: [seen.at(35, 40), seen.at(50, 55)],
    strip: seen.at(10, clientHeight - 10),
    aboveStrip: seen.at(10, clientHeight - 25),
  }).toEqual({
    size: [Math.round(clientWidth * seen.scale), Math.round(clientHeight * seen.scale)],
    square: '255,0,0',
    besideSquare: [blue, blue],
    strip: '0,255,0',
    aboveStrip: blue,
  });
}
