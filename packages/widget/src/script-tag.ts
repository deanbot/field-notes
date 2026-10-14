import type { Corner, Offset } from './button.ts';
import type { Surface } from './panel.ts';
import {
  type FieldNotesHandle,
  type FieldNotesOptions,
  findMount,
  mountFieldNotes,
  type Trigger,
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

const CORNERS: readonly string[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const TRIGGERS: readonly string[] = ['button', 'hotkey'];
const SURFACES: readonly string[] = ['popover', 'sheet', 'side'];
const SCREENSHOTS: readonly string[] = ['dom', 'display', 'off'];

/** `16` → 16; `8,24` → x 8, y 24. Anything else is ignored. */
function parseOffset(text: string): Offset | undefined {
  const parts = text.split(',').map((part) => Number(part.trim()));
  if (parts.length > 2 || parts.some((n) => !Number.isFinite(n))) return undefined;
  const [x = 0, y = x] = parts;
  return parts.length === 1 ? x : { x, y };
}

/**
 * Options from the script tag's `data-*` attributes: `data-enabled`
 * (`true`/`false`), `data-trigger` (`"button hotkey"`, or empty for API only),
 * `data-position` (a corner), `data-offset` (`16` or `8,24`), `data-surface`
 * (`popover`, `sheet` or `side`), `data-screenshot` (`dom`, `display` or `off`),
 * `data-hotkey`, `data-endpoint` and `data-token`.
 * Values it doesn't recognise are ignored.
 */
export function scriptOptions(script: HTMLOrSVGScriptElement | null): FieldNotesOptions {
  const data = script?.dataset ?? {};
  const options: FieldNotesOptions = {};
  if (data.enabled === 'true' || data.enabled === 'false')
    options.enabled = data.enabled === 'true';
  if (data.trigger !== undefined) {
    const words = data.trigger.split(/[\s,]+/).filter((word) => TRIGGERS.includes(word));
    options.trigger = words as Trigger[];
  }
  if (data.position && CORNERS.includes(data.position)) {
    options.buttonPosition = data.position as Corner;
  }
  const offset = data.offset ? parseOffset(data.offset) : undefined;
  if (offset !== undefined) options.buttonOffset = offset;
  if (data.surface && SURFACES.includes(data.surface)) options.surface = data.surface as Surface;
  if (data.screenshot && SCREENSHOTS.includes(data.screenshot)) {
    options.screenshot = data.screenshot as 'dom' | 'display' | 'off';
  }
  if (data.hotkey) options.hotkey = data.hotkey;
  if (data.endpoint) options.endpoint = data.endpoint;
  if (data.token) options.token = data.token;
  return options;
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
