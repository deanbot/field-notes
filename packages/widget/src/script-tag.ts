import { readOptions } from './attributes.ts';
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
  readonly toggle: () => Promise<void>;
  readonly unmount: () => void;
}

/**
 * Options from the script tag's `data-*` attributes, named as `<field-notes>`
 * names its own (see `readOptions`).
 */
export function scriptOptions(script: HTMLOrSVGScriptElement | null): FieldNotesOptions {
  const data = script?.dataset ?? {};
  return readOptions((name) => data[name]);
}

/**
 * Mounts from a script tag once the document has a body, and returns its API.
 * `injectedToken` is the token `field-notes serve` wrote into the script it
 * served; notes then go to the server the script came from.
 */
export function startScriptTag(
  script: HTMLOrSVGScriptElement | null,
  injectedToken?: string,
): ScriptApi {
  const src = script && 'src' in script ? script.src : '';
  const defaults: FieldNotesOptions = {
    ...(src ? { endpoint: new URL('/__field-notes', src).href } : {}),
    ...(injectedToken ? { token: injectedToken } : {}),
    ...scriptOptions(script),
  };
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
    toggle: () => handle?.toggle() ?? Promise.resolve(),
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
