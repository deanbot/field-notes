import { afterEach, describe, expect, it, vi } from 'vitest';
import { TAG_NAME } from './element.ts';
import { mountFieldNotes } from './mount.ts';
import { type ScriptApi, scriptOptions, startScriptTag } from './script-tag.ts';

function tag(attrs: Record<string, string> = {}): HTMLScriptElement {
  const script = document.createElement('script');
  Object.assign(script.dataset, attrs);
  return script;
}

let api: ScriptApi | undefined;

afterEach(() => {
  api?.unmount();
  vi.restoreAllMocks();
});

describe('scriptOptions', () => {
  it.each([
    [{ enabled: 'true' }, { enabled: true }],
    [{ enabled: 'false' }, { enabled: false }],
    [{ enabled: 'auto' }, {}],
    [{}, {}],
  ])('%o → %o', (attrs, expected) => {
    expect(scriptOptions(tag(attrs))).toEqual(expected);
  });

  it.each([
    [{ trigger: 'hotkey' }, { trigger: ['hotkey'] }],
    [{ trigger: 'button, hotkey' }, { trigger: ['button', 'hotkey'] }],
    [{ trigger: '' }, { trigger: [] }],
    [{ trigger: 'button bogus' }, { trigger: ['button'] }],
    [{ position: 'top-left' }, { buttonPosition: 'top-left' }],
    [{ position: 'middle' }, {}],
    [{ offset: '24' }, { buttonOffset: 24 }],
    [{ offset: '8, 24' }, { buttonOffset: { x: 8, y: 24 } }],
    [{ offset: '8,24,1' }, {}],
    [{ offset: 'far' }, {}],
    [{ hotkey: 'Ctrl+K' }, { hotkey: 'Ctrl+K' }],
    [{ surface: 'side' }, { surface: 'side' }],
    [{ surface: 'drawer' }, {}],
  ])('%o → %o', (attrs, expected) => {
    expect(scriptOptions(tag(attrs))).toEqual(expected);
  });

  it('defaults without a script element', () => {
    expect(scriptOptions(null)).toEqual({});
  });
});

describe('startScriptTag', () => {
  it('mounts at once when the document has loaded', async () => {
    api = startScriptTag(tag());
    expect(document.querySelectorAll(TAG_NAME)).toHaveLength(1);
    await api.open();
    expect(document.querySelector(TAG_NAME)?.shadowRoot?.querySelector('h2')).not.toBeNull();
    api.close();
    expect(document.querySelector(TAG_NAME)?.shadowRoot?.querySelector('h2')).toBeNull();
    await api.toggle();
    expect(document.querySelector(TAG_NAME)?.shadowRoot?.querySelector('h2')).not.toBeNull();
  });

  it('waits for DOMContentLoaded while the document is loading', () => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    api = startScriptTag(tag());
    expect(document.querySelectorAll(TAG_NAME)).toHaveLength(0);
    document.dispatchEvent(new Event('DOMContentLoaded'));
    expect(document.querySelectorAll(TAG_NAME)).toHaveLength(1);
  });

  it('honours data-enabled="false"', async () => {
    api = startScriptTag(tag({ enabled: 'false' }));
    expect(document.querySelectorAll(TAG_NAME)).toHaveLength(0);
    await api.open();
    api.close();
  });

  it('mount() replaces the current mount', () => {
    api = startScriptTag(tag());
    const first = document.querySelector(TAG_NAME);
    api.mount({ enabled: true });
    const all = document.querySelectorAll(TAG_NAME);
    expect(all).toHaveLength(1);
    expect(all[0]).not.toBe(first);
  });

  it('unmount() before the document loads cancels the pending mount', () => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    api = startScriptTag(tag());
    api.unmount();
    document.dispatchEvent(new Event('DOMContentLoaded'));
    expect(document.querySelectorAll(TAG_NAME)).toHaveLength(0);
  });

  it('mount() before the document loads replaces the pending mount', () => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    api = startScriptTag(tag());
    api.mount({ enabled: true });
    const mounted = document.querySelector(TAG_NAME);
    document.dispatchEvent(new Event('DOMContentLoaded'));
    const all = document.querySelectorAll(TAG_NAME);
    expect(all).toHaveLength(1);
    expect(all[0]).toBe(mounted);
  });

  it("leaves the app's own mount alone when it reused it", () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const app = mountFieldNotes({ enabled: true });
    const el = document.querySelector(TAG_NAME);
    api = startScriptTag(tag());
    api.unmount();
    expect(app.active).toBe(true);
    api.mount();
    expect(app.active).toBe(true);
    expect(document.querySelector(TAG_NAME)).toBe(el);
    app.unmount();
  });

  it('is a no-op API before anything mounts', async () => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    api = startScriptTag(tag());
    await api.open();
    await api.toggle();
    api.close();
    api.unmount();
    expect(document.querySelectorAll(TAG_NAME)).toHaveLength(0);
  });
});
