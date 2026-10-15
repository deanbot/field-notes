// The page copy reads only layout for elements away from the viewport. These
// tests hold it to the copy of every element with every style, and time it.
import { server } from 'vitest/browser';
import { afterEach, expect, it } from 'vitest';
import { captureScreenshot } from './screenshot.ts';
import { type Pixels, pixels } from './test-pixels.ts';

afterEach(() => {
  document.body.replaceChildren();
  document.head.querySelectorAll('style.test').forEach((el) => {
    el.remove();
  });
  scrollTo(0, 0);
});

function page(markup: string, css: string): void {
  document.body.innerHTML = markup;
  const style = document.createElement('style');
  style.className = 'test';
  style.textContent = css;
  document.head.append(style);
}

async function shoot(whole: boolean): Promise<Pixels> {
  const shot = await captureScreenshot(document.createElement('div'), { whole }).image;
  if (!shot) throw new Error('no screenshot');
  return pixels(shot.blob);
}

const repeat = (count: number, make: (index: number) => string): string =>
  Array.from({ length: count }, (_, index) => make(index)).join('');

/**
 * Things away from the viewport that decide where what's in it goes, or
 * how it looks: each kept by a different part of what's copied of them.
 */
const VARIED = `
  <style>
    body { margin: 0; font: 15px/1.4 serif; color: rgb(30, 30, 90); }
    section { margin: 0 8px; }
    h2 { margin: 24px 0 12px; font: bold 22px sans-serif; }
    table { border-collapse: collapse; }
    table.lined td { vertical-align: baseline; }
    td { border: 3px solid rgb(200, 0, 0); padding: 2px 9px; }
    .wide { font: italic bold 26px monospace; letter-spacing: 4px; }
    .row { display: flex; gap: 10px; width: 3200px; }
    .row > div { flex: 1 1 60px; height: 40px; background: rgb(0, 150, 0); }
    .row > .grow { flex-grow: 7; order: -1; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); width: 3000px; }
    .grid > div { height: 30px; background: rgb(0, 0, 200); }
    .grid > .placed { grid-column: 3 / 5; grid-row: 2; }
    p.long { width: 2600px; }
    p.long b { font: bold 28px sans-serif; letter-spacing: 6px; }
    p.long b::before { content: '»»'; }
    p.long i { font-size: 34px; }
    .shadow { height: 20px; box-shadow: 0 60px 0 20px rgb(250, 160, 0); }
    li { list-style-position: inside; }
    .tall { height: 1200px; }
    .base { display: flex; align-items: baseline; width: 3200px; }
    .big { display: flow-root; width: 1000px; font-size: 60px; }
    .side { width: 400px; text-align: right; }
  </style>
  <section>
    <h2>Collapsing into the section</h2>
    <ol>${repeat(40, (i) => `<li>item <i>${String(i)}</i></li>`)}</ol>
  </section>
  <div style="overflow: hidden"><p style="margin: 40px 0">kept to itself</p></div>
  <table>${repeat(20, () => '<tr><td>collapsed</td></tr>')}</table>
  <table>
    <tr><td class="wide">the widest cell, far above</td><td>b</td></tr>
    ${repeat(200, (i) => `<tr><td>row ${String(i)}</td><td><b>x</b></td></tr>`)}
  </table>
  <div class="base"><div class="big">Big</div><div class="side">lined up</div></div>
  <table class="lined" style="width: 1500px"><tr><td class="big">Big</td><td class="side">lined up</td></tr></table>
  <p class="long">${repeat(60, (i) => `<b>word<i>${String(i)}</i></b> and some text `)}</p>
  <div class="row">${repeat(30, () => '<div></div>')}<div class="grow"></div></div>
  <div class="grid">${repeat(40, () => '<div></div>')}<div class="placed"></div></div>
  <div class="tall"></div>
  <div class="shadow"></div>
  <div class="tall"></div>`;

it('copies a scrolled page as the copy of every element with every style does', async () => {
  page(VARIED, '');
  // Mid-table, mid-paragraph and mid-row, with the shadow cast from out of view.
  const target = document.querySelector('p.long');
  if (!target) throw new Error('no paragraph');
  const top = target.getBoundingClientRect().top + scrollY;
  scrollTo(1200, top - 200);
  expect([scrollX, scrollY]).toEqual([1200, top - 200]);
  const whole = await shoot(true);
  const fast = await shoot(false);
  expect([fast.width, fast.height]).toEqual([whole.width, whole.height]);
  // WebP's losses differ a little where anything does.
  const differences = fast.differences(whole, 48);
  expect(differences.slice(0, 5), `${String(differences.length)} pixels differ`).toEqual([]);
});

it('copies what is just out of view whole, as its paint can reach in', async () => {
  page(
    `<div class="shadow"></div><div style="height:3000px"></div>`,
    '.shadow { height: 20px; margin-top: 2000px; box-shadow: 0 -60px 0 0 rgb(250, 160, 0); }',
  );
  const shadow = document.querySelector('.shadow');
  if (!shadow) throw new Error('no shadow');
  // The box 50px below the viewport, its shadow 10px into it.
  const { clientHeight } = document.documentElement;
  scrollTo(0, shadow.getBoundingClientRect().top + scrollY - clientHeight - 50);
  expect(shadow.getBoundingClientRect().top).toBe(clientHeight + 50);
  const whole = await shoot(true);
  const fast = await shoot(false);
  expect(fast.at(10, clientHeight - 5)).toBe(whole.at(10, clientHeight - 5));
  // WebKit draws no shadow there in either copy.
  if (server.browser !== 'webkit') expect(fast.at(10, clientHeight - 5)).toBe('250,160,0');
});

it('keeps text that no longer fits a box out of view from reaching into view', async () => {
  // Small text fills the box; copied without its font, it would overflow it.
  page(
    `<div class="small">${repeat(400, () => 'text ')}</div><div style="height:3000px"></div>`,
    '.small { height: 200px; font: 4px/4px serif; color: rgb(200, 0, 0); }',
  );
  scrollTo(0, 200 + 8 + 110);
  const whole = await shoot(true);
  const fast = await shoot(false);
  // Out of view, the text isn't copied in its colour: look for any.
  const inked = (r: number, g: number, b: number): boolean => r + g + b < 600;
  expect(whole.some(inked)).toBe(false);
  expect(fast.some(inked)).toBe(false);
});

it('draws a gradient defined out of view as it is', async () => {
  page(
    `<svg width="0" height="0" style="position:absolute">
      <defs><linearGradient id="g"><stop class="stop" offset="0"/><stop class="stop" offset="1"/></linearGradient></defs>
    </svg>
    <div style="height:2000px"></div>
    <svg width="80" height="40"><rect class="filled" width="80" height="40"/></svg>
    <div style="height:2000px"></div>`,
    '.stop { stop-color: rgb(250, 0, 0); } .filled { fill: url(#g); }',
  );
  scrollTo(0, 1900);
  const filled = document.querySelector('.filled');
  if (!filled) throw new Error('no rect');
  const { left, top } = filled.getBoundingClientRect();
  const whole = await shoot(true);
  const fast = await shoot(false);
  expect(whole.at(left + 40, top + 20)).toBe('250,0,0');
  expect(fast.at(left + 40, top + 20)).toBe('250,0,0');
});

it('leaves out what is scaled to nothing in view, as the page does', async () => {
  page(
    `<div class="menu">a closed menu</div><div class="far">moved out of view</div>`,
    `.menu { position: absolute; top: 50px; left: 50px; padding: 10px; border: 4px solid rgb(0, 0, 0);
      font-size: 30px; transform: scale(0); }
    .far { position: absolute; top: 200px; left: 50px; border: 4px solid rgb(0, 0, 0);
      font-size: 30px; transform: translateX(-2000px); }`,
  );
  const fast = await shoot(false);
  expect(fast.some((r, g, b) => r + g + b < 600)).toBe(false);
});

async function sameAsWhole(): Promise<void> {
  const whole = await shoot(true);
  const fast = await shoot(false);
  const differences = fast.differences(whole, 48);
  expect(differences.slice(0, 5), `${String(differences.length)} pixels differ`).toEqual([]);
}

it('copies text that overflows a box out of view into view', async () => {
  page(
    `<div class="spill">${repeat(400, () => 'overflowing ')}</div><div style="height:4000px"></div>`,
    '.spill { margin-top: 1200px; height: 20px; width: 300px; font-size: 20px; }',
  );
  scrollTo(0, 1500);
  await sameAsWhole();
});

it('copies text that overflows a box left of the view into view', async () => {
  page(
    `<div class="spill">${repeat(200, () => 'sideways ')}</div><div style="width:6000px;height:10px"></div>`,
    '.spill { width: 300px; height: 40px; font-size: 20px; white-space: nowrap; }',
  );
  scrollTo(1500, 0);
  await sameAsWhole();
});

it('copies a pseudo-element positioned from a box out of view into view', async () => {
  page(
    `<div class="anchor"></div><div style="height:4000px"></div>`,
    `.anchor { position: relative; margin-top: 1200px; height: 20px; }
    .anchor::before { content: ''; position: absolute; top: 400px; width: 80px; height: 80px;
      background: rgb(0, 160, 0); }`,
  );
  scrollTo(0, 1500);
  await sameAsWhole();
});

/** The issue's page: a table of some 4,000 elements, scrolled to its middle. */
const TABLE = `<table>${repeat(800, (i) => `<tr><td>row ${String(i)}</td><td><b>x</b></td><td>y</td></tr>`)}</table>`;

it.runIf(server.browser !== 'firefox')(
  'copies a 4,000-element page in under 300 ms (Chromium and WebKit)',
  async () => {
    page(TABLE, 'td { padding: 4px; border: 1px solid #ccc; }');
    expect(document.body.querySelectorAll('*').length).toBeGreaterThanOrEqual(4000);
    scrollTo(0, document.documentElement.scrollHeight / 2);
    const times: number[] = [];
    // The first copy warms up the engine; the best of the rest is what's held.
    for (let run = 0; run < 4; run++) {
      const started = performance.now();
      const capture = captureScreenshot(document.createElement('div'));
      await capture.cloned;
      times.push(performance.now() - started);
      // A copy that failed would be quick too.
      expect(await capture.image).toBeDefined();
    }
    const best = Math.min(...times.slice(1));
    expect(best, `copies took ${times.map((t) => t.toFixed(0)).join(', ')} ms`).toBeLessThan(300);
  },
);
