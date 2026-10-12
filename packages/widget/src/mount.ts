import { type Enabled, isEnabled } from './activation.ts';
import { BUTTON_CSS, type Corner, type Offset, createButton } from './button.ts';
import { HANDLE_KEY, TAG_NAME, defineShell } from './element.ts';
import { matchesHotkey, parseHotkey } from './hotkey.ts';
import { isEditableTarget } from './keyboard.ts';
import type * as PanelModule from './panel.ts';

/** What opens the widget. The API (`open()`, `close()`, `toggle()`) always works. */
export type Trigger = 'button' | 'hotkey';

export interface FieldNotesOptions {
  /** When the widget is on. Default `'auto'`: dev builds only. */
  enabled?: Enabled | undefined;
  /** Default `['button', 'hotkey']`. An empty list leaves only the API. */
  trigger?: readonly Trigger[] | undefined;
  /** Corner for the floating button. Default `'bottom-right'`. */
  buttonPosition?: Corner | undefined;
  /** The button's distance from its corner, in px. Default `16`. */
  buttonOffset?: Offset | undefined;
  /** Default `'Alt+Shift+F'`. Modifiers (`Alt`, `Ctrl`, `Meta`, `Shift`) plus one key. */
  hotkey?: string | undefined;
}

export interface FieldNotesHandle {
  /** False when activation left the widget off; every method is then a no-op. */
  readonly active: boolean;
  /** Opens the widget, loading the panel on first use. */
  readonly open: () => Promise<void>;
  readonly close: () => void;
  /** Opens when closed (or closing), closes when open (or opening). */
  readonly toggle: () => Promise<void>;
  /** Removes the element and everything the widget added to the page. */
  readonly unmount: () => void;
}

type Shell = HTMLElement & { [HANDLE_KEY]?: FieldNotesHandle };

const inactive: FieldNotesHandle = Object.freeze({
  active: false,
  open: () => Promise.resolve(),
  close: () => undefined,
  toggle: () => Promise.resolve(),
  unmount: () => undefined,
});

// Applied to the shell itself. `!important` is what lets it beat host rules
// that match `<field-notes>` from outside, such as `* { color: red }`.
const SHELL_CSS = `:host { all: initial !important; }${BUTTON_CSS}`;

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

  const triggers = new Set(options.trigger ?? ['button', 'hotkey']);
  const hotkeyText = options.hotkey ?? 'Alt+Shift+F';
  const hotkey = triggers.has('hotkey') ? parseHotkey(hotkeyText) : undefined;
  if (triggers.has('hotkey') && !hotkey) warn(`"${hotkeyText}" isn't a hotkey; the hotkey is off.`);
  // Every listener the mount adds goes through this, and unmount() aborts it.
  const teardown = new AbortController();
  const { signal } = teardown;

  const button = triggers.has('button')
    ? createButton(options.buttonPosition ?? 'bottom-right', options.buttonOffset ?? 16)
    : undefined;
  const expanded = (open: boolean): void => {
    button?.setAttribute('aria-expanded', String(open));
  };

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
        wanted = false; // nothing opened, so the next toggle() opens again
        warn(`couldn't load the panel. ${String(error)}`);
        return;
      }
      if (!stillWanted()) return;
      shown = panel;
      panel.showPanel(root, { close: handle.close });
      expanded(true);
    },
    close: () => {
      wanted = false;
      shown?.hidePanel(root);
      shown = undefined;
      expanded(false);
    },
    toggle: () => {
      if (!wanted) return handle.open();
      handle.close();
      return Promise.resolve();
    },
    unmount: () => {
      if (!alive) return;
      alive = false;
      handle.close();
      teardown.abort();
      el.remove();
      Reflect.deleteProperty(el, HANDLE_KEY);
    },
  };

  if (button) {
    button.addEventListener('click', () => void handle.toggle(), { signal });
    root.append(button);
  }
  if (hotkey) {
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.defaultPrevented || event.repeat || event.isComposing) return;
        if (!matchesHotkey(hotkey, event)) return;
        // Typing in the host's fields never opens the widget; in our own
        // fields the hotkey still closes it.
        const ours = event.composedPath().includes(el);
        if (!ours && isEditableTarget(event.composedPath()[0] ?? null)) return;
        // Only now is the key ours to claim.
        event.preventDefault();
        void handle.toggle();
      },
      { signal },
    );
  }

  el[HANDLE_KEY] = handle;
  // A script tag in <head> can mount before <body> exists.
  ((document.body as HTMLElement | null) ?? document.documentElement).append(el);
  // Promoted once connected; older engines without popovers keep it fixed.
  if (button && 'showPopover' in button) button.showPopover();
  return handle;
}
