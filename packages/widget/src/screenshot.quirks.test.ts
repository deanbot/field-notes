// The DOM screenshot of a page in quirks mode, where <body> is what scrolls
// and reports the viewport's size. This file's tester page has no doctype.
import { afterEach, expect, it } from 'vitest';
import { captureScreenshot } from './screenshot.ts';
import { pixels } from './test-pixels.ts';

afterEach(() => {
  document.body.replaceChildren();
  scrollTo(0, 0);
});

const find = (selector: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`no ${selector}`);
  return el;
};

/** The middle of what's visible of `el`, within `clip` when given. */
function middle(el: Element, clip?: Element): { x: number; y: number } {
  const box = el.getBoundingClientRect();
  const limit = clip?.getBoundingClientRect() ?? box;
  const left = Math.max(box.left, limit.left);
  const right = Math.min(box.right, limit.right);
  const top = Math.max(box.top, limit.top);
  const bottom = Math.min(box.bottom, limit.bottom);
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

it('runs on a quirks-mode page, where <body> scrolls', () => {
  expect([document.compatMode, document.scrollingElement]).toEqual(['BackCompat', document.body]);
});

it('shows the viewport as it is seen: scrolled both ways, fixed (nested too), sticky and absolute elements, inner scrollers', async () => {
  document.body.innerHTML = `
    <h1 style="margin-top:30px;height:10px"></h1>
    <div class="fixed" style="position:fixed;top:0;left:0;right:0;height:40px;background:rgb(255,0,0)"></div>
    <div class="corner" style="position:fixed;bottom:0;left:0;width:60px;height:30px;background:rgb(255,0,255)"></div>
    <div><div class="nested" style="position:fixed;top:100px;right:0;width:40px;height:40px;background:rgb(0,255,255)"></div></div>
    <div style="height:600px;width:3000px"></div>
    <section style="height:3000px">
      <div class="sticky" style="position:sticky;top:50px;height:30px;background:rgb(0,0,255)"></div>
    </section>
    <div class="absolute" style="position:absolute;top:1100px;left:150px;width:50px;height:50px;background:rgb(0,255,0)"></div>
    <div class="inner" style="position:absolute;top:1300px;left:300px;width:100px;height:100px;overflow:auto">
      <div style="height:300px"></div><div class="scrolled" style="height:100px;background:rgb(255,255,0)"></div>
    </div>`;
  find('.inner').scrollTop = 300;
  scrollTo(100, 1000);
  expect([document.body.scrollLeft, document.body.scrollTop]).toEqual([100, 1000]);
  const shot = await captureScreenshot(document.createElement('div')).image;
  if (!shot) throw new Error('no screenshot');
  const seen = await pixels(shot.blob);
  const { clientWidth, clientHeight } = document.body;
  expect([seen.width, seen.height]).toEqual([
    Math.floor(clientWidth * seen.scale),
    Math.floor(clientHeight * seen.scale),
  ]);
  const expected: [string, string][] = [
    ['.fixed', '255,0,0'],
    ['.corner', '255,0,255'],
    ['.nested', '0,255,255'],
    ['.sticky', '0,0,255'],
    ['.absolute', '0,255,0'],
  ];
  for (const [selector, colour] of expected) {
    const { x, y } = middle(find(selector));
    expect(seen.at(x, y), selector).toBe(colour);
  }
  const { x, y } = middle(find('.scrolled'), find('.inner'));
  expect(seen.at(x, y), '.scrolled').toBe('255,255,0');
});
