// The display capture of a page in quirks mode, where <html> is as tall as
// the page and <body> reports the viewport's size. This file's tester page
// has no doctype. The shared tab is faked: a canvas the size of the view.
import { server } from 'vitest/browser';
import { afterEach, expect, it, vi } from 'vitest';
import { captureDisplay } from './display.ts';
import { expectView, shareTab } from './test-display.ts';
import { pixels } from './test-pixels.ts';

// Headless WebKit never plays a canvas stream.
const plays = server.browser !== 'webkit';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  scrollTo(0, 0);
});

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
    const { cropped } = shareTab();
    const host = document.createElement('div');
    document.body.append(host);
    const shot = await captureDisplay(
      host.attachShadow({ mode: 'open' }),
      new AbortController().signal,
    );
    if (!shot || shot === 'dom') throw new Error(`no display capture: ${String(shot)}`);
    expectView(await pixels(shot.blob), cropped);
  },
);
