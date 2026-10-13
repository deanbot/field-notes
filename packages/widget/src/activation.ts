/**
 * When the widget is on.
 * - `'auto'`: dev builds only.
 * - `'query'`: off until a page is opened with `?field-notes=1`, then on in
 *   this browser until `?field-notes=0`, in any build.
 * - a function: the host decides at mount time.
 * - `true` / `false`: forced.
 */
export type Enabled = 'auto' | 'query' | boolean | (() => boolean);

/** Where `'query'` remembers that this browser turned the widget on. */
export const ENABLED_KEY = 'field-notes:enabled';

// Never declared globally for the widget: it's a browser package. Bundlers
// replace the expression `process.env.NODE_ENV` textually.
declare const process: { env: { NODE_ENV?: string } };

/**
 * True unless the consuming bundler marked this a production build.
 *
 * The check is left for the host's bundler to resolve (Vite, webpack, Next
 * and others replace `process.env.NODE_ENV`), so a production build folds it
 * to `false`. Where nothing replaces it (ESM loaded without a bundler),
 * `process` doesn't exist and this counts as a dev build. The script-tag
 * build fixes it to development at build time: only the dev sink serves it.
 */
export function isDevBuild(): boolean {
  try {
    return process.env.NODE_ENV !== 'production';
  } catch {
    return true;
  }
}

/**
 * `'query'`: `?field-notes=1` turns it on and remembers, `=0` forgets. Without
 * storage, `=1` still turns it on for this page.
 */
function fromQuery(): boolean {
  const asked = new URLSearchParams(location.search).get('field-notes');
  try {
    if (asked === '1') localStorage.setItem(ENABLED_KEY, asked);
    else if (asked === '0') localStorage.removeItem(ENABLED_KEY);
    else return localStorage.getItem(ENABLED_KEY) === '1';
  } catch {
    // Storage is blocked: go by the URL alone.
  }
  return asked === '1';
}

/** Resolves `enabled` once, at mount. A throwing function leaves the widget off. */
export function isEnabled(enabled: Enabled, dev: boolean = isDevBuild()): boolean {
  if (enabled === 'query') return fromQuery();
  if (typeof enabled === 'function') {
    try {
      // Strictly true: a promise or other truthy value doesn't count.
      const on: unknown = enabled();
      return on === true;
    } catch (error) {
      console.warn('[field-notes] enabled() threw, so the widget stays off.', error);
      return false;
    }
  }
  return enabled === 'auto' ? dev : enabled;
}
