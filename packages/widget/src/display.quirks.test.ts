// The display capture of a page in quirks mode, where <html> is as tall as
// the page and <body> reports the viewport's size. This file's tester page
// has no doctype. The shared tab is faked: a canvas the size of the view.
import { server } from 'vitest/browser';
import { afterEach, expect, it, vi } from 'vitest';
import { captureDisplay } from './display.ts';
import { pixels } from './test-pixels.ts';

// Headless WebKit never plays a canvas stream.
const plays = server.browser !== 'webkit';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  scrollTo(0, 0);
});

/** Shares a stand-in for the tab: blue, a red square at (40, 30) and a green strip along the bottom. */
function shareTab(): void {
  vi.stubGlobal('CropTarget', { fromElement: () => Promise.resolve({}) });
  const scale = Math.min(devicePixelRatio, 2);
  const { clientWidth, clientHeight } = document.body;
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

it('runs on a quirks-mode page, where <html> is as tall as the page', () => {
  document.body.innerHTML = '<div style="height:3000px"></div>';
  expect(document.compatMode).toBe('BackCompat');
  expect(document.documentElement.clientHeight).toBeGreaterThan(innerHeight);
});

it.runIf(plays)(
  "is the view's size on a scrolled quirks page, each point where it is on screen",
  async () => {
    document.body.innerHTML = '<div style="height:3000px;width:3000px"></div>';
    scrollTo(100, 1000);
    expect([document.body.scrollLeft, document.body.scrollTop]).toEqual([100, 1000]);
    shareTab();
    const host = document.createElement('div');
    document.body.append(host);
    const shot = await captureDisplay(
      host.attachShadow({ mode: 'open' }),
      new AbortController().signal,
    );
    if (!shot || shot === 'dom') throw new Error(`no display capture: ${String(shot)}`);
    const seen = await pixels(shot.blob);
    const { clientWidth, clientHeight } = document.body;
    expect([seen.width, seen.height]).toEqual([
      Math.round(clientWidth * seen.scale),
      Math.round(clientHeight * seen.scale),
    ]);
    expect(seen.at(50, 40)).toBe('255,0,0');
    expect(seen.at(35, 40)).toBe('0,0,255');
    expect(seen.at(50, 55)).toBe('0,0,255');
    expect(seen.at(10, clientHeight - 10)).toBe('0,255,0');
    expect(seen.at(10, clientHeight - 25)).toBe('0,0,255');
  },
);
