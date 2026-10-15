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
  const { cropped } = shareTab();
  const host = document.createElement('div');
  parent.append(host);
  const shot = await captureDisplay(
    host.attachShadow({ mode: 'open' }),
    new AbortController().signal,
  );
  if (!shot || shot === 'dom') throw new Error(`no display capture: ${String(shot)}`);
  expectView(await pixels(shot.blob), cropped);
}

it.runIf(plays)('is the view on a tall, scrolled page', async () => {
  document.body.innerHTML = '<div style="height:3000px"></div>';
  scrollTo(0, 500);
  await capture(document.body);
});

// Each of these is the containing block of a fixed element in the widget,
// unless it's in the top layer.
it.runIf(plays)('is the view when <body> has a transform', async () => {
  document.body.style.transform = 'translateZ(0)';
  document.body.innerHTML = '<div style="height:3000px"></div>';
  scrollTo(0, 500);
  await capture(document.body);
});

it.runIf(plays).each([
  ['transformed', 'transform:translateZ(0);margin-left:50px'],
  ['filtered and painting only inside itself', 'filter:blur(0);contain:paint'],
])('is the view when the widget is in a component %s', async (_, style) => {
  document.body.innerHTML = `<div style="height:2500px"></div><div class="component" style="${style};width:300px;height:3000px"></div>`;
  scrollTo(0, 500);
  const component = document.querySelector<HTMLElement>('.component');
  if (!component) throw new Error('no component');
  await capture(component);
});
