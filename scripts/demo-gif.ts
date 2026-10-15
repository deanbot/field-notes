// Records docs/demo.gif: examples/vite-vue in a headless browser, a note left
// on the order button, and the note.md it becomes. Run `pnpm build` first;
// it needs ffmpeg. Page video only: nothing captures the screen.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = resolve(import.meta.dirname, '..');
const example = join(root, 'examples/vite-vue');
const items = join(example, '.field-notes/items');
const out = join(root, 'docs/demo.gif');
const size = { width: 960, height: 600 };

// The sink signs notes with `git config user.name`: a made-up one, here.
const work = mkdtempSync(join(tmpdir(), 'field-notes-demo-'));
writeFileSync(join(work, 'gitconfig'), '[user]\n\tname = Sam Rivera\n');
process.env.GIT_CONFIG_GLOBAL = join(work, 'gitconfig');
process.env.GIT_CONFIG_NOSYSTEM = '1';

const before = new Set(readdirSync(items, { withFileTypes: true }).map((e) => e.name));
const server = await createServer({
  root: example,
  configFile: join(example, 'vite.config.ts'),
  logLevel: 'silent',
  server: { port: 0, host: 'localhost' },
});
await server.listen();
const browser = await chromium.launch();
let noteDir: string | undefined;
try {
  // A fixed timezone and locale, so the note shows nothing about this machine.
  const context = await browser.newContext({
    viewport: size,
    timezoneId: 'UTC',
    locale: 'en-US',
    recordVideo: { dir: work, size },
  });
  const page = await context.newPage();
  const url = server.resolvedUrls?.local[0] ?? '';
  await page.goto(url);
  await page.getByRole('heading', { name: 'Checkout' }).waitFor();
  await page.waitForTimeout(800);

  await page.getByRole('button', { name: 'Field notes' }).click();
  await page.locator('field-notes .shot img[src^="blob:"]').waitFor();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Pick element' }).click();
  await page.waitForTimeout(300);
  const hover = async (name: string): Promise<{ x: number; y: number }> => {
    const box = await page.getByText(name, { exact: true }).boundingBox();
    if (!box) throw new Error(`${name} isn't on screen`);
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(point.x, point.y, { steps: 15 });
    await page.waitForTimeout(500);
    return point;
  };
  await hover('Field notebook, dot grid');
  const target = await hover('Place order');
  await page.mouse.click(target.x, target.y);
  await page.waitForTimeout(500);
  await page
    .locator('#field-notes-text')
    .pressSequentially('Should say "Pay $24" so the total is clear.', {
      delay: 45,
    });
  await page.waitForTimeout(500);
  await page.getByRole('radio', { name: 'change', exact: true }).click();
  await page.waitForTimeout(500);
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(1200);

  // The note on disk, shown as a file.
  for (let i = 0; i < 100 && !noteDir; i++) {
    await page.waitForTimeout(100);
    noteDir = readdirSync(items).find((name) => !before.has(name));
  }
  if (!noteDir) throw new Error('the note never landed');
  const text = readFileSync(join(items, noteDir, 'note.md'), 'utf8');
  const escape = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  await page.setContent(`<!doctype html>
    <body style="margin:0;background:#0d1117;color:#e6edf3;font:14px/1.5 ui-monospace,Menlo,monospace">
      <div style="padding:10px 16px;background:#161b22;color:#8b949e;border-bottom:1px solid #30363d">
        .field-notes/items/${escape(noteDir)}/note.md
      </div>
      <pre style="margin:0;padding:16px;white-space:pre-wrap">${escape(text)}</pre>
    </body>`);
  // The top, then down to the body at the end of the file.
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  });
  await page.waitForTimeout(3000);

  const video = page.video();
  await context.close();
  const recorded = await video?.path();
  if (!recorded) throw new Error('no video was recorded');
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-i',
    recorded,
    '-vf',
    'fps=10,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5',
    '-loop',
    '0',
    out,
  ]);
  console.log(`wrote ${out}`);
} finally {
  await browser.close();
  await server.close();
  if (noteDir) rmSync(join(items, noteDir), { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
}
