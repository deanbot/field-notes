import { afterEach, describe, expect, it, vi } from 'vitest';
import { TAG_NAME } from './element.ts';
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

  it('is a no-op API before anything mounts', async () => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    api = startScriptTag(tag());
    await api.open();
    api.close();
    api.unmount();
    expect(document.querySelectorAll(TAG_NAME)).toHaveLength(0);
  });
});
