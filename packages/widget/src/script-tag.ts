import {
  type FieldNotesHandle,
  type FieldNotesOptions,
  findMount,
  mountFieldNotes,
} from './mount.ts';

/**
 * `window.FieldNotes` in the script-tag build. When the page has already
 * mounted the widget (an npm import), it shares that mount: `open()` and
 * `close()` drive it, but `mount()` and `unmount()` never tear it down.
 */
export interface ScriptApi {
  /** Mounts the widget, replacing this tag's own mount. Defaults to the tag's `data-*` options. */
  readonly mount: (options?: FieldNotesOptions) => FieldNotesHandle;
  readonly open: () => Promise<void>;
  readonly close: () => void;
  readonly unmount: () => void;
}

/** Options from the script tag's `data-*` attributes. */
export function scriptOptions(script: HTMLOrSVGScriptElement | null): FieldNotesOptions {
  const enabled = script?.dataset.enabled;
  if (enabled === 'true') return { enabled: true };
  if (enabled === 'false') return { enabled: false };
  return {};
}

/** Mounts from a script tag once the document has a body, and returns its API. */
export function startScriptTag(script: HTMLOrSVGScriptElement | null): ScriptApi {
  const defaults = scriptOptions(script);
  let handle: FieldNotesHandle | undefined;
  let owned = false; // false when `handle` is a mount the page made
  // Cancels the mount that waits for the document, once any call overrides it.
  const pending = new AbortController();
  const api: ScriptApi = {
    mount: (options = defaults) => {
      pending.abort();
      if (owned) handle?.unmount();
      const existing = findMount();
      handle = mountFieldNotes(options);
      owned = handle !== existing;
      return handle;
    },
    open: () => handle?.open() ?? Promise.resolve(),
    close: () => handle?.close(),
    unmount: () => {
      pending.abort();
      if (owned) handle?.unmount();
    },
  };
  // A script tag in <head> runs before <body> exists.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => api.mount(), {
      once: true,
      signal: pending.signal,
    });
  } else {
    api.mount();
  }
  return api;
}
