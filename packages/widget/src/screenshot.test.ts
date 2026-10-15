import type { Note } from '@field-notes/core/note';
import { page as browser, server, userEvent } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { deliver } from './deliver.ts';
import { TAG_NAME } from './element.ts';
import { type FieldNotesHandle, type FieldNotesOptions, mountFieldNotes } from './mount.ts';
import { pickElement } from './picker.ts';
import * as screenshotModule from './screenshot.ts';
import { MAX_BYTES, WEBP_ABOVE, encode } from './image.ts';
import { captureScreenshot } from './screenshot.ts';
import type { Attachments } from './transport.ts';
import { consoleSeen, watchConsole } from './test-console.ts';

vi.mock('./deliver.ts', () => ({ deliver: vi.fn(() => Promise.resolve()) }));
vi.mock('./picker.ts', () => ({ pickElement: vi.fn() }));
vi.mock('./screenshot.ts', { spy: true });

const delivered = vi.mocked(deliver);
let handle: FieldNotesHandle | undefined;

beforeEach(() => {
  localStorage.clear();
  delivered.mockClear();
});

afterEach(() => {
  handle?.unmount();
  handle = undefined;
  document.body.replaceChildren();
  document.head.querySelectorAll('style.test').forEach((el) => {
    el.remove();
  });
  scrollTo(0, 0);
  vi.restoreAllMocks();
});

function page(markup: string, css = ''): void {
  document.body.innerHTML = markup;
  if (css) {
    const style = document.createElement('style');
    style.className = 'test';
    style.textContent = css;
    document.head.append(style);
  }
}

function find(selector: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`no ${selector}`);
  return el;
}

interface Pixels {
  /** Device pixels per CSS pixel. */
  readonly scale: number;
  readonly width: number;
  /** `r,g,b` at a point in CSS pixels. */
  readonly at: (x: number, y: number) => string;
  /** Whether any pixel passes `test`. */
  readonly some: (test: (r: number, g: number, b: number) => boolean) => boolean;
}

async function pixels(blob: Blob): Promise<Pixels> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2d context');
  context.drawImage(bitmap, 0, 0);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const scale = bitmap.width / document.documentElement.clientWidth;
  return {
    scale,
    width: bitmap.width,
    at: (x, y) => {
      const i = (Math.floor(y * scale) * canvas.width + Math.floor(x * scale)) * 4;
      return `${String(data[i])},${String(data[i + 1])},${String(data[i + 2])}`;
    },
    some: (test) => {
      for (let i = 0; i < data.length; i += 4) {
        if (test(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0)) return true;
      }
      return false;
    },
  };
}

async function shoot(exclude: Element = document.createElement('div')): Promise<Pixels> {
  const shot = await captureScreenshot(exclude).image;
  if (!shot) throw new Error('no screenshot');
  return pixels(shot.blob);
}

/** A tenth of a second of silence as a WAV data URL: a source any engine's <video> loads. */
function silence(): string {
  const samples = 800; // 8 kHz, 8-bit, mono
  const bytes = new Uint8Array(44 + samples).fill(128);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string): void => {
    for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i);
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); // the format chunk's size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // channels
  view.setUint32(24, 8000, true); // sample rate
  view.setUint32(28, 8000, true); // bytes a second
  view.setUint16(32, 1, true); // bytes a frame
  view.setUint16(34, 8, true); // bits a sample
  text(36, 'data');
  view.setUint32(40, samples, true);
  return `data:audio/wav;base64,${btoa(String.fromCharCode(...bytes))}`;
}

const reddish = (r: number, g: number, b: number): boolean => r > 150 && g < 100 && b < 100;

/**
 * A page of masked content, all red: text, its overflow, a far-off
 * pseudo-element, a descendant positioned away, a password, an image, a
 * shadow root and a same-origin frame. Resolves to where the red is on
 * screen, but the pseudo-element's, which can't be measured.
 */
async function maskedPage(): Promise<() => DOMRect[]> {
  const red = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="red"/></svg>')}`;
  page(
    `
    <p data-field-notes-mask class="text" style="color:rgb(255,0,0);background:rgb(255,0,0)">4111 1111 1111 1111</p>
    <div data-field-notes-mask class="overflow" style="width:20px;white-space:nowrap;color:rgb(255,0,0);font-size:40px">OVERFLOWING</div>
    <div data-field-notes-mask class="before" style="height:20px"></div>
    <div data-field-notes-mask><div><span class="away" style="position:absolute;left:200px;top:300px;width:40px;height:40px;background:rgb(255,0,0)"></span></div></div>
    <input type="password" value="hunter2" style="color:rgb(255,0,0);font-size:40px">
    <img data-field-notes-mask src="${red}" alt="Jane's passport" width="40" height="40">
    <div class="host"></div>
    <iframe class="frame" style="width:200px;height:60px;border:0"></iframe>`,
    `.before::before { content: 'SECRET'; position: absolute; left: 250px; top: 500px; color: rgb(255,0,0); font-size: 40px; }`,
  );
  const inShadow = document.createElement('div');
  inShadow.setAttribute('data-field-notes-mask', '');
  inShadow.style.cssText = 'height:40px;background:rgb(255,0,0)';
  inShadow.textContent = 'shadow';
  find('.host').attachShadow({ mode: 'open' }).append(inShadow);
  const frame = find('.frame');
  if (!(frame instanceof HTMLIFrameElement)) throw new Error('no frame');
  await new Promise((loaded) => {
    frame.addEventListener('load', loaded, { once: true });
    frame.srcdoc =
      '<body style="margin:0"><div data-field-notes-mask style="height:60px;background:rgb(255,0,0)">in a frame</div></body>';
  });
  return () => {
    const overflow = document.createRange();
    overflow.selectNodeContents(find('.overflow'));
    const inFrame = frame.contentDocument?.body.firstElementChild?.getBoundingClientRect();
    const { x, y } = frame.getBoundingClientRect();
    return [
      ...['.text', '.away', 'input[type="password"]', 'img'].map((s) =>
        find(s).getBoundingClientRect(),
      ),
      overflow.getBoundingClientRect(),
      inShadow.getBoundingClientRect(),
      ...(inFrame
        ? [new DOMRect(inFrame.x + x, inFrame.y + y, inFrame.width, inFrame.height)]
        : []),
    ];
  };
}

describe('captureScreenshot', () => {
  it('shows the viewport as it is seen: scrolled both ways, fixed, sticky and absolute elements, inner scrollers', async () => {
    // The default 8px body margin, a first child's margin collapsing through
    // <body>, absolute elements under a static <body>, and a wide page.
    page(`
      <h1 style="margin-top:30px;height:10px"></h1>
      <div style="position:fixed;top:0;left:0;right:0;height:40px;background:rgb(255,0,0)"></div>
      <div style="position:fixed;bottom:0;left:0;width:60px;height:30px;background:rgb(255,0,255)"></div>
      <div style="height:600px;width:3000px"></div>
      <section style="height:3000px">
        <div style="position:sticky;top:50px;height:30px;background:rgb(0,0,255)"></div>
      </section>
      <div style="position:absolute;top:1100px;left:150px;width:50px;height:50px;background:rgb(0,255,0)"></div>
      <div class="inner" style="position:absolute;top:1300px;left:300px;width:100px;height:100px;overflow:auto">
        <div style="height:300px"></div><div style="height:100px;background:rgb(255,255,0)"></div>
      </div>`);
    find('.inner').scrollTop = 300;
    scrollTo(100, 1000);
    const shot = await shoot();
    const height = document.documentElement.clientHeight;
    expect(shot.width).toBe(Math.floor(document.documentElement.clientWidth * shot.scale));
    expect(shot.at(300, 20)).toBe('255,0,0');
    expect(shot.at(30, height - 15)).toBe('255,0,255');
    expect(shot.at(300, 65)).toBe('0,0,255');
    expect(shot.at(51, 101)).toBe('0,255,0');
    expect(shot.at(98, 148)).toBe('0,255,0');
    expect(shot.at(250, 350)).toBe('255,255,0');
  });

  it('never shows masked content: text, its overflow, pseudo-elements, passwords, images, shadow roots, same-origin frames', async () => {
    await maskedPage();
    const shot = await shoot();
    expect(shot.some(reddish)).toBe(false);
  });

  it('paints over masked boxes where they are on screen: scrolled, fixed, sticky, in a scrolled box, in a modal dialog', async () => {
    // An inset shadow is drawn from the element's own style, which the copy
    // keeps: only the paint hides it.
    const fill = (size: number): string => `box-shadow:inset 0 0 0 ${String(size)}px rgb(255,0,0)`;
    page(`
      <div data-field-notes-mask style="position:fixed;top:0;left:10px;width:100px;height:40px;${fill(50)}"></div>
      <div style="height:600px;width:3000px"></div>
      <section style="height:3000px">
        <div data-field-notes-mask style="position:sticky;top:60px;margin-left:100px;width:120px;height:30px;${fill(60)}"></div>
      </section>
      <div data-field-notes-mask style="position:absolute;top:1100.5px;left:150.3px;width:50px;height:50px;${fill(50)}"></div>
      <div class="inner" style="position:absolute;top:1300px;left:300px;width:100px;height:100px;overflow:auto">
        <div style="height:300px"></div><div data-field-notes-mask style="height:60px;${fill(60)}"></div>
      </div>
      <dialog class="modal" style="padding:0;border:0"><div data-field-notes-mask style="width:80px;height:40px;${fill(40)}"></div></dialog>`);
    find('.inner').scrollTop = 300;
    scrollTo(100, 1000);
    const modal = find('.modal');
    if (!(modal instanceof HTMLDialogElement)) throw new Error('no dialog');
    modal.showModal();
    const centres = [...document.querySelectorAll('[data-field-notes-mask]')].map((el) => {
      const { x, y, width, height } = el.getBoundingClientRect();
      return { x: x + width / 2, y: y + height / 2 };
    });
    expect(centres).toHaveLength(5);
    const shot = await shoot();
    modal.close();
    expect(shot.some(reddish)).toBe(false);
    // And the paint is where each box is on screen.
    for (const { x, y } of centres) expect(shot.at(x, y)).toBe('136,136,136');
  });

  it('leaves out the element it excludes, and what is in it', async () => {
    page(`<div class="widget" style="position:fixed;inset:0"></div>`);
    find('.widget').attachShadow({ mode: 'open' }).innerHTML =
      '<div style="position:fixed;inset:0;background:rgb(255,0,0)"></div>';
    const shot = await shoot(find('.widget'));
    expect(shot.some(reddish)).toBe(false);
  });

  it("copies the page at once, without waiting for images that haven't loaded", async () => {
    page(`<img loading="lazy" src="/never.png" style="margin-top:5000px">`);
    const started = performance.now();
    const capture = captureScreenshot(document.createElement('div'));
    await capture.cloned;
    expect(performance.now() - started).toBeLessThan(1000);
    await capture.image;
  });

  it('leaves nothing behind in the page, done or cancelled', async () => {
    page(`<p>page</p>`);
    const before = document.body.innerHTML;
    await captureScreenshot(document.createElement('div')).image;
    expect(document.body.innerHTML).toBe(before);
    const capture = captureScreenshot(document.createElement('div'));
    await capture.cloned;
    capture.cancel();
    expect(await capture.image).toBeUndefined();
    expect(document.body.innerHTML).toBe(before);
  });

  it('copies a page with a video in it, logging nothing to the console, even from the browser itself', async () => {
    // The copy waits for the video to load: tasks run mid-copy, and styles
    // read after them must come from a frame that has loaded. Firefox warns
    // "Layout was forced before the page was fully loaded" for one that
    // hasn't, or the copy fails on its missing <body>.
    page(
      `<video src="${silence()}" width="40" height="20"></video><h2>heading</h2><article>text</article><aside>aside</aside><ol><li>item</li></ol><table><tr><td>cell</td></tr></table>`,
    );
    await watchConsole();
    for (let i = 0; i < 3; i++) {
      expect(await captureScreenshot(document.createElement('div')).image).toBeDefined();
    }
    expect(await consoleSeen()).toEqual([]);
  });
});

describe('encode', () => {
  function noise(width: number, height: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2d context');
    const image = context.createImageData(width, height);
    // Random bytes: nothing compresses them.
    for (let i = 0; i < image.data.length; i += 65_536) {
      crypto.getRandomValues(image.data.subarray(i, i + 65_536));
    }
    context.putImageData(image, 0, 0);
    return canvas;
  }

  it('keeps a small image as PNG', async () => {
    const shot = await encode(noise(100, 100));
    expect(shot?.name).toBe('screenshot.png');
    expect(shot?.blob.type).toBe('image/png');
  });

  it('makes a large one WebP where the browser can, names it by its type, and halves it until it fits', async () => {
    const big = noise(2600, 2600);
    const shot = await encode(big);
    if (!shot) throw new Error('nothing encoded');
    expect(shot.name).toBe(shot.blob.type === 'image/webp' ? 'screenshot.webp' : 'screenshot.png');
    expect(shot.blob.size).toBeLessThanOrEqual(MAX_BYTES);
    if (shot.blob.type === 'image/png') {
      expect(shot.blob.size).toBeLessThanOrEqual(WEBP_ABOVE * 8);
      expect((await createImageBitmap(shot.blob)).width).toBeLessThan(2600);
    }
  });
});

describe('the screenshot in the widget', () => {
  function mount(options: FieldNotesOptions = {}): FieldNotesHandle {
    handle = mountFieldNotes({ enabled: true, ...options });
    return handle;
  }
  function shadow(): ShadowRoot {
    const root = document.querySelector(TAG_NAME)?.shadowRoot;
    if (!root) throw new Error('not mounted');
    return root;
  }
  const thumb = (): HTMLImageElement | null => shadow().querySelector('.shot img');
  function button(label: string): HTMLButtonElement {
    const found = [...shadow().querySelectorAll('button')].find(
      (el) => el.textContent.trim() === label || el.ariaLabel === label,
    );
    if (!found) throw new Error(`no ${label} button`);
    return found;
  }
  async function submitted(): Promise<{ note: Note; attachments: Attachments }> {
    const text = shadow().querySelector('textarea');
    if (!text) throw new Error('no textarea');
    await userEvent.type(text, 'A note');
    await userEvent.click(button('Add note'));
    await vi.waitFor(() => {
      expect(delivered).toHaveBeenCalledOnce();
    });
    const [note, , attachments = {}] = delivered.mock.calls[0] ?? [];
    if (!note) throw new Error('nothing delivered');
    return { note, attachments };
  }

  it('attaches a screenshot of the page, taken without the widget in it', async () => {
    page(
      `<p style="padding:40px">The page</p>`,
      `${TAG_NAME} { --field-notes-bg: rgb(255,0,0); --field-notes-button-bg: rgb(255,0,0); }`,
    );
    await mount().open();
    await vi.waitFor(() => {
      expect(thumb()?.src).toMatch(/^blob:/);
    });
    const { note, attachments } = await submitted();
    expect(note.screenshot).toBe('screenshot.png');
    const blob = attachments['screenshot.png'];
    if (!blob) throw new Error('no screenshot attached');
    expect((await pixels(blob)).some(reddish)).toBe(false);
  });

  it('can be removed before the note is added', async () => {
    page(`<p>The page</p>`);
    await mount().open();
    await userEvent.click(button('Remove screenshot'));
    expect(thumb()).toBeNull();
    const { note, attachments } = await submitted();
    expect(note).not.toHaveProperty('screenshot');
    expect(attachments).toEqual({});
  });

  it("takes none when they're off", async () => {
    page(`<p>The page</p>`);
    await mount({ screenshot: 'off' }).open();
    expect(thumb()).toBeNull();
    const { note } = await submitted();
    expect(note).not.toHaveProperty('screenshot');
    expect(screenshotModule.captureScreenshot).not.toHaveBeenCalled();
  });

  it('is taken again after a pick, while the panel is still closed, but not once removed', async () => {
    page(`<button class="buy">Buy</button>`);
    vi.mocked(pickElement).mockResolvedValue({
      element: { selector: '.buy', tag: 'button', rect: { x: 0, y: 0, w: 10, h: 10 } },
      label: 'button “Buy”',
    });
    await mount().open();
    expect(screenshotModule.captureScreenshot).toHaveBeenCalledOnce();
    const retaken = vi.mocked(screenshotModule.captureScreenshot).mockImplementationOnce(() => {
      expect(shadow().querySelector('dialog')?.open).toBe(false);
      const blob = new Blob(['retaken'], { type: 'image/png' });
      return {
        cloned: Promise.resolve(),
        image: Promise.resolve({ blob, name: 'screenshot.png' }),
        cancel: vi.fn(),
      };
    });
    await userEvent.click(button('Pick element'));
    await vi.waitFor(() => {
      expect(retaken).toHaveBeenCalledTimes(2);
      expect(thumb()?.src).toMatch(/^blob:/);
    });
    await userEvent.click(button('Remove screenshot'));
    await userEvent.click(shadow().querySelector('.picked') ?? button('Pick element'));
    await vi.waitFor(() => {
      expect(shadow().querySelector('dialog')?.open).toBe(true);
    });
    expect(retaken).toHaveBeenCalledTimes(2);
  });

  it('fits in the actions row on a 320px phone, with a long pick beside it', async () => {
    await browser.viewport(320, 568);
    try {
      page(`<button class="buy">Buy</button>`);
      vi.mocked(pickElement).mockResolvedValue({
        element: { selector: '.buy', tag: 'button', rect: { x: 0, y: 0, w: 10, h: 10 } },
        label: 'button “Upgrade to the annual plan and save”',
      });
      await mount({ surface: 'sheet' }).open();
      await userEvent.click(button('Pick element'));
      await vi.waitFor(() => {
        expect(shadow().querySelector('.picked')).not.toBeNull();
        expect(thumb()?.src).toMatch(/^blob:/);
      });
      const actions = shadow().querySelector('.actions');
      if (!actions) throw new Error('no actions row');
      expect(actions.scrollWidth).toBeLessThanOrEqual(actions.clientWidth);
      const row = actions.getBoundingClientRect();
      for (const el of [thumb(), button('Remove screenshot'), button('Add note')]) {
        const box = el?.getBoundingClientRect();
        expect(box?.left).toBeGreaterThanOrEqual(row.left);
        expect(box?.right).toBeLessThanOrEqual(row.right);
      }
    } finally {
      await browser.viewport(414, 896);
    }
  });

  it('goes without one when it fails', async () => {
    page(`<p>The page</p>`);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(screenshotModule.captureScreenshot).mockImplementationOnce(() => {
      throw new Error('broken');
    });
    await mount().open();
    expect(shadow().querySelector('dialog')?.open).toBe(true);
    expect(thumb()).toBeNull();
    const { note } = await submitted();
    expect(note).not.toHaveProperty('screenshot');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("couldn't take a screenshot"));
  });

  it('is dropped when the panel closes, and a new one taken on the next open', async () => {
    page(`<p>The page</p>`);
    const h = mount();
    await h.open();
    const [first] = vi.mocked(screenshotModule.captureScreenshot).mock.results;
    if (first?.type !== 'return') throw new Error('no capture');
    const cancel = vi.spyOn(first.value, 'cancel');
    h.close();
    expect(cancel).toHaveBeenCalled();
    await h.open();
    expect(screenshotModule.captureScreenshot).toHaveBeenCalledTimes(2);
  });

  describe('shared as a tab', () => {
    // A stand-in for the tab: a canvas the size of the viewport at the
    // screenshot's scale, blue, with red where the masked field is.
    function fakeTab(): HTMLCanvasElement {
      const scale = Math.min(devicePixelRatio, 2);
      const { clientWidth, clientHeight } = document.documentElement;
      const canvas = document.createElement('canvas');
      canvas.width = clientWidth * scale;
      canvas.height = clientHeight * scale;
      return canvas;
    }
    interface Share {
      readonly ask: ReturnType<typeof vi.fn>;
      readonly tracks: MediaStreamTrack[];
      /** The widget button's display each time a frame was drawn from the share. */
      readonly hiddenAtGrab: string[];
      /** The box of each element the share was cropped to. */
      readonly cropped: DOMRect[];
      readonly answer: () => void;
    }
    function share(
      how: {
        answer?: 'share' | 'deny' | 'other';
        later?: boolean;
        regionCapture?: boolean;
        /** As if not opened by a click or key (an earlier test's may still count). */
        gesture?: boolean;
        /** Where the tab shows masked content in red. Default: the password field. */
        secrets?: () => DOMRect[];
      } = {},
    ): Share {
      const {
        answer: reply = 'share',
        later = false,
        regionCapture = true,
        gesture = true,
        secrets = () =>
          [...document.querySelectorAll('input[type="password"]')].map((el) =>
            el.getBoundingClientRect(),
          ),
      } = how;
      const cropped: DOMRect[] = [];
      vi.stubGlobal(
        'CropTarget',
        regionCapture
          ? {
              fromElement: (el: Element) => {
                cropped.push(el.getBoundingClientRect());
                return Promise.resolve({});
              },
            }
          : undefined,
      );
      const tab = fakeTab();
      const paint = tab.getContext('2d');
      const tracks: MediaStreamTrack[] = [];
      const draw = (): void => {
        if (!paint) return;
        paint.fillStyle = 'rgb(0, 0, 255)';
        paint.fillRect(0, 0, tab.width, tab.height);
        const scale = tab.width / document.documentElement.clientWidth;
        paint.fillStyle = 'rgb(255, 0, 0)';
        for (const { x, y, width, height } of secrets()) {
          paint.fillRect(x * scale, y * scale, width * scale, height * scale);
        }
      };
      // Some engines only send a frame once the canvas changes.
      const timer = setInterval(draw, 16);
      onTestFinished(() => {
        clearInterval(timer);
      });
      let release: () => void = () => undefined;
      const answered = new Promise<void>((resolve) => {
        release = resolve;
      });
      if (!later) release();
      const ask = vi.fn(async () => {
        if (!gesture || !navigator.userActivation.isActive) {
          throw new DOMException('needs a user gesture', 'InvalidStateError');
        }
        await answered;
        if (reply === 'deny') throw new DOMException('Permission denied', 'NotAllowedError');
        draw();
        const stream = tab.captureStream();
        tracks.push(...stream.getTracks());
        for (const track of stream.getVideoTracks()) {
          Object.assign(track, {
            cropTo: () =>
              reply === 'other'
                ? Promise.reject(new DOMException('not this tab', 'NotSupportedError'))
                : Promise.resolve(),
          });
        }
        return stream;
      });
      vi.spyOn(navigator.mediaDevices, 'getDisplayMedia').mockImplementation(ask);
      const hiddenAtGrab: string[] = [];
      // eslint-disable-next-line @typescript-eslint/unbound-method -- applied with its own this below
      const drawImage = CanvasRenderingContext2D.prototype.drawImage;
      vi.spyOn(CanvasRenderingContext2D.prototype, 'drawImage').mockImplementation(function (
        this: CanvasRenderingContext2D,
        ...args: Parameters<typeof drawImage>
      ) {
        if (args[0] instanceof HTMLVideoElement) {
          hiddenAtGrab.push(getComputedStyle(trigger()).display);
        }
        drawImage.apply(this, args);
      });
      return { ask, tracks, hiddenAtGrab, cropped, answer: release };
    }
    const trigger = (): HTMLElement => {
      const found = shadow().querySelector<HTMLElement>('.trigger');
      if (!found) throw new Error('no trigger');
      return found;
    };
    const stopped = (tracks: MediaStreamTrack[]): boolean =>
      tracks.length > 0 && tracks.every((track) => track.readyState === 'ended');
    // Headless WebKit never plays a canvas stream; Safari can't prove a share
    // is this tab anyway, so it only ever takes the DOM screenshot.
    const plays = server.browser !== 'webkit';

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it.runIf(plays)(
      "shares this tab without the widget, masked, at the DOM screenshot's scale",
      async () => {
        page(`<input type="password" value="secret" style="margin:40px">`);
        const { ask, tracks, hiddenAtGrab, cropped } = share();
        mount({ screenshot: 'display' });
        await userEvent.click(trigger());
        await vi.waitFor(() => {
          expect(thumb()?.src).toMatch(/^blob:/);
        });
        expect(ask).toHaveBeenCalledOnce();
        expect(screenshotModule.captureScreenshot).not.toHaveBeenCalled();
        expect(hiddenAtGrab).toEqual(['none']);
        expect(getComputedStyle(trigger()).display).not.toBe('none');
        // The page's whole view, even though the page is shorter than it.
        const { clientWidth, clientHeight } = document.documentElement;
        expect(cropped.map(({ x, y, width, height }) => [x, y, width, height])).toEqual([
          [0, 0, clientWidth, clientHeight],
        ]);
        const views = [...shadow().children].filter(
          (el) => el instanceof HTMLElement && el.style.position === 'fixed',
        );
        expect(views).toEqual([]);
        expect(stopped(tracks)).toBe(true);
        const { note, attachments } = await submitted();
        expect(note.screenshot).toBe('screenshot.png');
        const blob = attachments['screenshot.png'];
        if (!blob) throw new Error('no screenshot attached');
        const shot = await pixels(blob);
        expect(shot.scale).toBe(Math.min(devicePixelRatio, 2));
        expect(shot.at(5, 5)).toBe('0,0,255');
        expect(shot.some(reddish)).toBe(false);
      },
    );

    it.runIf(plays)(
      'masks what the DOM screenshot does: overflow, descendants positioned away, shadow roots, frames',
      async () => {
        const secrets = await maskedPage();
        expect(secrets()).toHaveLength(7);
        share({ secrets });
        mount({ screenshot: 'display' });
        await userEvent.click(trigger());
        await vi.waitFor(() => {
          expect(thumb()?.src).toMatch(/^blob:/);
        });
        const { attachments } = await submitted();
        const blob = attachments['screenshot.png'];
        if (!blob) throw new Error('no screenshot attached');
        const shot = await pixels(blob);
        expect(shot.some(reddish)).toBe(false);
        for (const { x, y, width, height } of secrets()) {
          expect(shot.at(x + width / 2, y + height / 2)).toBe('136,136,136');
        }
      },
    );

    it('takes the DOM screenshot when the user shares something else', async () => {
      page(`<p>The page</p>`);
      const { tracks } = share({ answer: 'other' });
      mount({ screenshot: 'display' });
      await userEvent.click(trigger());
      await vi.waitFor(() => {
        expect(thumb()?.src).toMatch(/^blob:/);
      });
      expect(screenshotModule.captureScreenshot).toHaveBeenCalledOnce();
      expect(stopped(tracks)).toBe(true);
    });

    it('goes without, quietly, when the user declines', async () => {
      page(`<p>The page</p>`);
      const warn = vi.spyOn(console, 'warn');
      const { ask } = share({ answer: 'deny' });
      mount({ screenshot: 'display' });
      await userEvent.click(trigger());
      await vi.waitFor(() => {
        expect(shadow().querySelector('dialog')?.open).toBe(true);
      });
      expect(ask).toHaveBeenCalledOnce();
      expect(thumb()).toBeNull();
      expect(shadow().querySelector('.error')?.textContent).toBe('');
      const { note } = await submitted();
      expect(note).not.toHaveProperty('screenshot');
      expect(screenshotModule.captureScreenshot).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    });

    it("takes the DOM screenshot when it can't ask: no user gesture", async () => {
      page(`<p>The page</p>`);
      const { ask } = share({ gesture: false });
      await mount({ screenshot: 'display' }).open();
      expect(ask).toHaveBeenCalledOnce();
      expect(screenshotModule.captureScreenshot).toHaveBeenCalledOnce();
    });

    it("takes the DOM screenshot without asking where it can't prove a share is this tab", async () => {
      page(`<p>The page</p>`);
      const { ask } = share({ regionCapture: false });
      mount({ screenshot: 'display' });
      await userEvent.click(trigger());
      await vi.waitFor(() => {
        expect(screenshotModule.captureScreenshot).toHaveBeenCalledOnce();
      });
      expect(ask).not.toHaveBeenCalled();
    });

    it('stops a share that comes after the widget unmounted', async () => {
      page(`<p>The page</p>`);
      const { ask, tracks, answer } = share({ later: true });
      mount({ screenshot: 'display' });
      await userEvent.click(trigger());
      await vi.waitFor(() => {
        expect(ask).toHaveBeenCalledOnce();
      });
      handle?.unmount();
      answer();
      await vi.waitFor(() => {
        expect(stopped(tracks)).toBe(true);
      });
      expect(screenshotModule.captureScreenshot).not.toHaveBeenCalled();
    });

    it.runIf(plays)('takes the DOM screenshot after a pick, not a second share', async () => {
      page(`<button class="buy">Buy</button>`);
      vi.mocked(pickElement).mockResolvedValue({
        element: { selector: '.buy', tag: 'button', rect: { x: 0, y: 0, w: 10, h: 10 } },
        label: 'button “Buy”',
      });
      const { ask } = share();
      mount({ screenshot: 'display' });
      await userEvent.click(trigger());
      await vi.waitFor(() => {
        expect(thumb()?.src).toMatch(/^blob:/);
      });
      await userEvent.click(button('Pick element'));
      await vi.waitFor(() => {
        expect(screenshotModule.captureScreenshot).toHaveBeenCalledOnce();
      });
      expect(ask).toHaveBeenCalledOnce();
    });
  });

  describe('pasted or dropped', () => {
    async function imageFile(color: string, type = 'image/png'): Promise<File> {
      const canvas = document.createElement('canvas');
      canvas.width = 30;
      canvas.height = 20;
      const paint = canvas.getContext('2d');
      if (!paint) throw new Error('no 2d context');
      paint.fillStyle = color;
      paint.fillRect(0, 0, 30, 20);
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, type);
      });
      if (!blob) throw new Error('not encoded');
      return new File([blob], `photo.${type.slice(6)}`, { type: blob.type });
    }
    function transfer(file: File, text?: string): DataTransfer {
      const data = new DataTransfer();
      data.items.add(file);
      if (text) data.setData('text/plain', text);
      return data;
    }
    const textarea = (): HTMLTextAreaElement => {
      const found = shadow().querySelector('textarea');
      if (!found) throw new Error('no textarea');
      return found;
    };
    /** False if the widget took it (prevented the default). */
    function paste(data: DataTransfer): boolean {
      const event = new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      });
      // Set directly: Firefox makes its own copy of a clipboardData passed to
      // the constructor, without the files.
      Object.defineProperty(event, 'clipboardData', { value: data });
      return textarea().dispatchEvent(event);
    }
    function drag(type: 'dragover' | 'drop', data: DataTransfer): boolean {
      return textarea().dispatchEvent(
        new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true }),
      );
    }
    async function opened(options: FieldNotesOptions = {}): Promise<void> {
      page(`<p>The page</p>`);
      await mount(options).open();
      if (options.screenshot !== 'off') {
        await vi.waitFor(() => {
          expect(thumb()?.src).toMatch(/^blob:/);
        });
      }
    }
    async function attached(): Promise<string> {
      const before = thumb()?.src;
      await vi.waitFor(() => {
        expect(thumb()?.src).toMatch(/^blob:/);
        expect(thumb()?.src).not.toBe(before);
      });
      return thumb()?.src ?? '';
    }

    it('takes the screenshot’s place when pasted, encoded again as image.png', async () => {
      await opened();
      expect(paste(transfer(await imageFile('rgb(0, 0, 255)', 'image/jpeg')))).toBe(false);
      await attached();
      const { note, attachments } = await submitted();
      expect(note.screenshot).toBe('image.png');
      expect(Object.keys(attachments)).toEqual(['image.png']);
      const blob = attachments['image.png'];
      if (!blob) throw new Error('no image attached');
      const bitmap = await createImageBitmap(blob);
      expect([bitmap.width, bitmap.height]).toEqual([30, 20]);
    });

    it('leaves a paste that has text too to the textarea', async () => {
      await opened();
      expect(paste(transfer(await imageFile('blue'), 'Some text'))).toBe(true);
      const { note } = await submitted();
      expect(note.screenshot).toBe('screenshot.png');
    });

    it('takes a dropped image, and ignores a dropped file that isn’t one', async () => {
      await opened();
      const text = transfer(new File(['hello'], 'notes.txt', { type: 'text/plain' }));
      expect(drag('dragover', text)).toBe(false);
      expect(drag('drop', text)).toBe(false);
      const image = transfer(await imageFile('green'));
      expect(drag('dragover', image)).toBe(false);
      expect(drag('drop', image)).toBe(false);
      await attached();
      const { note } = await submitted();
      expect(note.screenshot).toBe('image.png');
    });

    it("says so, and keeps the screenshot, when the image can't be read", async () => {
      await opened();
      paste(transfer(new File(['not a png'], 'broken.png', { type: 'image/png' })));
      await vi.waitFor(() => {
        expect(shadow().querySelector('.error')?.textContent).toBe("Couldn't use that image.");
      });
      const { note } = await submitted();
      expect(note.screenshot).toBe('screenshot.png');
    });

    it("takes none when screenshots are off, and doesn't stand in the way", async () => {
      await opened({ screenshot: 'off' });
      const image = transfer(await imageFile('blue'));
      expect(paste(image)).toBe(true);
      expect(drag('dragover', image)).toBe(true);
      expect(thumb()).toBeNull();
      const { note } = await submitted();
      expect(note).not.toHaveProperty('screenshot');
    });
  });
});
