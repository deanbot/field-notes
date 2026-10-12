import { type Enabled, isEnabled } from './activation.ts';
import { HANDLE_KEY, TAG_NAME, defineShell } from './element.ts';
import type * as PanelModule from './panel.ts';

export interface FieldNotesOptions {
  /** When the widget is on. Default `'auto'`: dev builds only. */
  enabled?: Enabled | undefined;
}

export interface FieldNotesHandle {
  /** False when activation left the widget off; every method is then a no-op. */
  readonly active: boolean;
  /** Opens the widget, loading the panel on first use. */
  readonly open: () => Promise<void>;
  readonly close: () => void;
  /** Removes the element and everything the widget added to the page. */
  readonly unmount: () => void;
}

type Shell = HTMLElement & { [HANDLE_KEY]?: FieldNotesHandle };

const inactive: FieldNotesHandle = Object.freeze({
  active: false,
  open: () => Promise.resolve(),
  close: () => undefined,
  unmount: () => undefined,
});

// Applied to the shell itself. `!important` is what lets it beat host rules
// that match `<field-notes>` from outside, such as `* { color: red }`.
const SHELL_CSS = ':host { all: initial !important; }';

/**
 * The live mount on the page, from any copy of the widget. It looks past
 * other `<field-notes>` elements, such as one from a stranger's registration.
 */
export function findMount(): FieldNotesHandle | undefined {
  for (const el of document.querySelectorAll<Shell>(TAG_NAME)) {
    if (el[HANDLE_KEY]?.active) return el[HANDLE_KEY];
  }
  return undefined;
}

const warn = (message: string): void => {
  console.warn(`[field-notes] ${message}`);
};

/**
 * Adds the widget to the page. Nothing renders until it's opened, and the
 * panel code isn't loaded until then either.
 *
 * Mounting twice, including from two copies of the widget (script tag and
 * npm import), warns and returns the existing mount instead of throwing.
 * Where there's no DOM, or activation says no, it returns an inactive handle.
 */
export function mountFieldNotes(options: FieldNotesOptions = {}): FieldNotesHandle {
  if (typeof document === 'undefined' || typeof customElements === 'undefined') return inactive;
  if (!isEnabled(options.enabled ?? 'auto')) return inactive;

  const mounted = findMount();
  if (mounted) {
    warn('already mounted; reusing the existing widget.');
    return mounted;
  }

  const warning = defineShell();
  if (warning) warn(warning);

  const el = document.createElement(TAG_NAME) as Shell;
  let root: ShadowRoot;
  try {
    root = el.attachShadow({ mode: 'open' });
  } catch (error) {
    warn(`can't attach to <${TAG_NAME}>, so the widget stays off. ${String(error)}`);
    return inactive;
  }
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(SHELL_CSS);
  root.adoptedStyleSheets = [sheet];

  type Panel = typeof PanelModule;
  let alive = true;
  let wanted = false; // the last call was open(), not close()
  let shown: Panel | undefined;
  let loading: Promise<Panel> | undefined;
  // Re-checked after the panel loads: close(), unmount() or another open()
  // may have run meanwhile.
  const stillWanted = (): boolean => alive && wanted && !shown;

  const handle: FieldNotesHandle = {
    get active() {
      return alive;
    },
    open: async () => {
      if (!alive) return;
      wanted = true;
      if (shown) return;
      loading ??= import('./panel.ts');
      let panel: Panel;
      try {
        panel = await loading;
      } catch (error) {
        loading = undefined;
        warn(`couldn't load the panel. ${String(error)}`);
        return;
      }
      if (!stillWanted()) return;
      shown = panel;
      panel.showPanel(root, { close: handle.close });
    },
    close: () => {
      wanted = false;
      shown?.hidePanel(root);
      shown = undefined;
    },
    unmount: () => {
      if (!alive) return;
      alive = false;
      handle.close();
      el.remove();
      Reflect.deleteProperty(el, HANDLE_KEY);
    },
  };

  el[HANDLE_KEY] = handle;
  // A script tag in <head> can mount before <body> exists.
  ((document.body as HTMLElement | null) ?? document.documentElement).append(el);
  return handle;
}
