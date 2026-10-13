// Its own file: once <field-notes> is defined, the registry can't forget it.
import { afterEach, expect, it, vi } from 'vitest';
import { TAG_NAME } from './element.ts';
import { mountFieldNotes } from './mount.ts';

let claimShadow = false;

// Something other than field-notes owns the tag.
customElements.define(
  TAG_NAME,
  class extends HTMLElement {
    constructor() {
      super();
      if (claimShadow) this.attachShadow({ mode: 'open' });
    }
  },
);

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it('warns and reuses a tag registered by something else', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const handle = mountFieldNotes({ enabled: true, screenshot: 'off' });
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('defined by something else'));
  expect(handle.active).toBe(true);
  await handle.open();
  expect(document.querySelector(TAG_NAME)?.shadowRoot?.querySelector('dialog')).not.toBeNull();
  handle.unmount();
});

it("stays off, without throwing, when that element's shadow root is taken", () => {
  claimShadow = true;
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const handle = mountFieldNotes({ enabled: true, screenshot: 'off' });
  expect(handle.active).toBe(false);
  expect(warn).toHaveBeenLastCalledWith(expect.stringContaining("can't attach"));
});

it("finds the widget's mount behind a host's own <field-notes>", () => {
  claimShadow = false;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  document.body.append(document.createElement(TAG_NAME));
  const first = mountFieldNotes({ enabled: true, screenshot: 'off' });
  expect(mountFieldNotes({ enabled: true, screenshot: 'off' })).toBe(first);
  expect(document.querySelectorAll(TAG_NAME)).toHaveLength(2);
  first.unmount();
});
