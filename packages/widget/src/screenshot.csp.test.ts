// The DOM screenshot on a page whose Content Security Policy blocks data:
// images (img-src 'self' blob:), set in this file's tester page.
import { afterEach, expect, it, vi } from 'vitest';
import { captureScreenshot } from './screenshot.ts';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it('runs on a page whose policy blocks data: images', async () => {
  const violation = new Promise<string>((resolve) => {
    document.addEventListener(
      'securitypolicyviolation',
      (event) => {
        resolve(event.blockedURI);
      },
      {
        once: true,
      },
    );
  });
  const loaded = await new Promise<boolean>((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve(true);
    };
    img.onerror = () => {
      resolve(false);
    };
    img.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
  });
  expect(loaded).toBe(false);
  expect(await violation).toBe('data');
});

it("attaches no screenshot when the page's policy blocks what it's drawn from, and says why", async () => {
  document.body.innerHTML = `<p style="color:rgb(255,0,0)">The page</p>`;
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const capture = captureScreenshot(document.createElement('div'));
  expect(await capture.image).toBeUndefined();
  await capture.cloned;
  expect(warn).toHaveBeenCalledOnce();
  expect(String(warn.mock.calls[0]?.[0])).toMatch(/Content Security Policy blocks data: images/);
  expect(document.querySelector('iframe')).toBeNull();
});
