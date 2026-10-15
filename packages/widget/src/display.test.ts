// The display capture's size, on a standards-mode page. The shared tab is
// faked: a canvas the size of the view.
import { server } from 'vitest/browser';
import { afterEach, it, vi } from 'vitest';
import { captureDisplay } from './display.ts';
import { expectView, shareTab } from './test-display.ts';
import { pixels } from './test-pixels.ts';

// Headless WebKit never plays a canvas stream.
const plays = server.browser !== 'webkit';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  document.body.style.transform = '';
  scrollTo(0, 0);
});

/** A display capture with the widget's shadow root inside `parent`. */
async function capture(parent: HTMLElement): Promise<void> {
  shareTab();
  const host = document.createElement('div');
  parent.append(host);
  const shot = await captureDisplay(
    host.attachShadow({ mode: 'open' }),
    new AbortController().signal,
  );
  if (!shot || shot === 'dom') throw new Error(`no display capture: ${String(shot)}`);
  expectView(await pixels(shot.blob));
}

it.runIf(plays)("is the view's size on a tall page", async () => {
  document.body.innerHTML = '<div style="height:3000px"></div>';
  await capture(document.body);
});

it.runIf(plays)("is the view's size when <body> has a transform", async () => {
  // <body> is then what a fixed element in the widget is placed in.
  document.body.style.transform = 'translateZ(0)';
  document.body.innerHTML = '<div style="height:3000px"></div>';
  await capture(document.body);
});

it.runIf(plays)("is the view's size when the widget is in a transformed component", async () => {
  document.body.innerHTML =
    '<div class="component" style="transform:translateZ(0);height:3000px"></div>';
  const component = document.querySelector<HTMLElement>('.component');
  if (!component) throw new Error('no component');
  await capture(component);
});
