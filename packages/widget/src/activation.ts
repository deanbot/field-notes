/**
 * When the widget is on.
 * - `'auto'`: dev builds only.
 * - a function: the host decides at mount time.
 * - `true` / `false`: forced.
 */
export type Enabled = 'auto' | boolean | (() => boolean);

// Never declared globally for the widget: it's a browser package. Bundlers
// replace the expression `process.env.NODE_ENV` textually.
declare const process: { env: { NODE_ENV?: string } };

/**
 * True unless the consuming bundler marked this a production build.
 *
 * The check is left for the host's bundler to resolve (Vite, webpack, Next
 * and others replace `process.env.NODE_ENV`), so a production build folds it
 * to `false`. Where nothing replaces it, as in the script-tag build that only
 * the local dev sink serves, `process` doesn't exist and this is a dev build.
 */
export function isDevBuild(): boolean {
  try {
    return process.env.NODE_ENV !== 'production';
  } catch {
    return true;
  }
}

/** Resolves `enabled` once, at mount. A throwing function leaves the widget off. */
export function isEnabled(enabled: Enabled, dev: boolean = isDevBuild()): boolean {
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
