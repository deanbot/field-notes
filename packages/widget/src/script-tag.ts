import { type FieldNotesHandle, type FieldNotesOptions, mountFieldNotes } from './mount.ts';

/** `window.FieldNotes` in the script-tag build. */
export interface ScriptApi {
  /** Mounts the widget, replacing the current mount. Defaults to the tag's `data-*` options. */
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
  // Cancels the mount that waits for the document, once any call overrides it.
  const pending = new AbortController();
  const api: ScriptApi = {
    mount: (options = defaults) => {
      pending.abort();
      handle?.unmount();
      handle = mountFieldNotes(options);
      return handle;
    },
    open: () => handle?.open() ?? Promise.resolve(),
    close: () => handle?.close(),
    unmount: () => {
      pending.abort();
      handle?.unmount();
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
