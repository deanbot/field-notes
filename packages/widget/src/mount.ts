import { type Enabled, isEnabled } from './activation.ts';
import { BUTTON_CSS, type Corner, type Offset, createButton, setBadge } from './button.ts';
import { HANDLE_KEY, TAG_NAME, defineShell } from './element.ts';
import { matchesHotkey, parseHotkey } from './hotkey.ts';
import { isEditableTarget } from './keyboard.ts';
import type * as ConsoleModule from './console-errors.ts';
import type * as ExportModule from './export.ts';
import type * as PanelModule from './panel.ts';
import type { Capture } from './image.ts';
import type * as DisplayModule from './display.ts';
import type * as ScreenshotModule from './screenshot.ts';
import type * as SyncModule from './sync.ts';
import { PENDING_KEY, readPending, writePending } from './pending.ts';
import type { Surface } from './panel.ts';

/** What opens the widget. The API (`open()`, `close()`, `toggle()`) always works. */
export type Trigger = 'button' | 'hotkey';

export interface FieldNotesOptions {
  /**
   * When the widget is on. Default `'auto'`: dev builds only. `'query'`: in any
   * build, once this browser has opened a page with `?field-notes=1`.
   */
  enabled?: Enabled | undefined;
  /** Default `['button', 'hotkey']`. An empty list leaves only the API. */
  trigger?: readonly Trigger[] | undefined;
  /** Corner for the floating button. Default `'bottom-right'`. */
  buttonPosition?: Corner | undefined;
  /** The button's distance from its corner, in px. Default `16`. */
  buttonOffset?: Offset | undefined;
  /**
   * Layout: `'popover'` (anchored to the button), `'sheet'` (bottom, up to 40%
   * of the viewport) or `'side'`. Default `'popover'`, or `'sheet'` with no
   * button.
   */
  surface?: Surface | undefined;
  /**
   * Default `'Alt+Shift+F'`. Modifiers (`Alt`, `Ctrl`, `Meta`, `Shift`) plus one
   * key: a letter, digit, punctuation, `Space`, a `KeyboardEvent.code` name or
   * a named key such as `F2`. Letters, digits and punctuation match by their
   * US-layout position.
   */
  hotkey?: string | undefined;
  /** Note types offered as one-click chips. Default `['bug', 'change', 'idea', 'question']`. */
  types?: readonly string[] | undefined;
  /** Recorded on each note. Default `'local'`. */
  environment?: string | undefined;
  /**
   * Recorded on each note when set. Without it, the local sink records
   * `git config user.name`, and export mode asks for a name once and
   * keeps it in this browser.
   */
  author?: string | (() => string) | undefined;
  /**
   * Extra data for each note: app version, feature flags, store state…
   * Called when the widget opens; it must return (or resolve to) plain data.
   * If it throws, rejects or takes over a second, the note goes without it.
   */
  context?: (() => unknown) | undefined;
  /**
   * Opt-in: keep the page's last errors (`console.error`, uncaught errors and
   * unhandled rejections) and attach them to each note. `true` keeps 20.
   */
  consoleErrors?: boolean | number | undefined;
  /**
   * Called right before a surface opens. A host with its own focus trap (a
   * modal library) can pause it here; see docs/recipes/host-focus-trap.md.
   */
  onOpen?: (() => void) | undefined;
  /** Called once after each surface closes, whatever closed it. Unpause here. */
  onClose?: (() => void) | undefined;
  /**
   * `'dom'` (default) attaches a screenshot of what's on screen, taken as the
   * widget opens (so it isn't in it) and again after a pick. Passwords and
   * `[data-field-notes-mask]` content are painted over. `'display'` asks the
   * browser to share this tab instead, for exact pixels: only where it can
   * prove the share is this tab (Chromium), with `'dom'` everywhere else and
   * after a pick. Its masking is paint alone: iframes are painted over, and
   * pseudo-element content drawn outside a masked element's box shows. A pasted or dropped image takes the screenshot's place.
   * `'off'` takes none, and accepts no pasted or dropped images.
   */
  screenshot?: 'dom' | 'display' | 'off' | undefined;
  /**
   * The local sink's URL. Default `/__field-notes` on the page's origin; the
   * script tag served by `field-notes serve` defaults to that server.
   */
  endpoint?: string | undefined;
  /**
   * The sink's token. Without one, the widget asks a sink on the page's own
   * origin (the Vite plugin, the middleware) for it; a sink elsewhere needs
   * it given. Until there's one, notes wait in the outbox. The script tag
   * served by `field-notes serve` has it.
   */
  token?: string | undefined;
  /**
   * `'local'` (default) sends notes to the local sink. `'export'` sends
   * nothing anywhere: notes stay in this browser until "My notes" exports
   * them as a zip.
   */
  mode?: 'local' | 'export' | undefined;
  /**
   * Export mode: days "Download last export again" stays available. Then the
   * exported notes are cleared, the next time the panel opens. Default 7.
   */
  exportRetentionDays?: number | undefined;
  /**
   * Export mode: suggest an export once the unexported notes reach this many,
   * or this size. Default `{ notes: 50, megabytes: 100 }`.
   */
  storageWarning?: { notes?: number | undefined; megabytes?: number | undefined } | undefined;
}

/** Loads the export chunk; only the npm build has one. */
export type LoadExport = () => Promise<typeof ExportModule>;

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

export type Shell = HTMLElement & { [HANDLE_KEY]?: FieldNotesHandle };

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

/** How long an open waits for the page to be copied before the surface covers it. */
const CLONE_WAIT_MS = 1000;

/**
 * Whether this browser can prove a screen share is this tab (Region Capture,
 * in Chromium), so asking for one is worth it. No `mediaDevices` outside a
 * secure context.
 */
const canCaptureTab = (): boolean =>
  Reflect.get(window, 'CropTarget') !== undefined &&
  'mediaDevices' in navigator &&
  'getDisplayMedia' in navigator.mediaDevices;

const warn = (message: string): void => {
  console.warn(`[field-notes] ${message}`);
};

/** Calls a host hook; one that throws can't stop the widget opening or closing. */
const hook = (fn: (() => void) | undefined): void => {
  try {
    fn?.();
  } catch (error) {
    warn(`a hook threw. ${String(error)}`);
  }
};

/**
 * Adds the widget to the page. Nothing renders until it's opened, and the
 * panel code isn't loaded until then either.
 *
 * Mounting twice, including from two copies of the widget (script tag and
 * npm import), warns and returns the existing mount instead of throwing.
 * Where there's no DOM, or activation says no, it returns an inactive handle.
 *
 * With `declared`, a `<field-notes>` the page put there, it mounts onto that
 * element, and unmounting empties it instead of removing it.
 */
export function mountFieldNotes(
  options: FieldNotesOptions = {},
  loadExport?: LoadExport,
  declared?: Shell,
): FieldNotesHandle {
  if (typeof document === 'undefined' || typeof customElements === 'undefined') return inactive;
  if (!isEnabled(options.enabled ?? 'auto')) return inactive;

  const mounted = findMount();
  if (mounted) {
    warn(
      options.onOpen || options.onClose
        ? 'already mounted; reusing it. Its onOpen/onClose stay; these are ignored.'
        : 'already mounted; reusing the existing widget.',
    );
    return mounted;
  }

  const warning = defineShell();
  if (warning) warn(warning);

  const el: Shell = declared ?? document.createElement(TAG_NAME);
  let root: ShadowRoot;
  try {
    // A declared element keeps its root between mounts: it can only have one.
    root = declared?.shadowRoot ?? el.attachShadow({ mode: 'open' });
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

  const corner = options.buttonPosition ?? 'bottom-right';
  const button = triggers.has('button')
    ? createButton(corner, options.buttonOffset ?? 16)
    : undefined;
  const surface = options.surface ?? (button ? 'popover' : 'sheet');
  // Export mode sends nothing anywhere, not even a request for the token.
  const exporting = options.mode === 'export';
  // A sync storage read, not IndexedDB: mounting stays cheap.
  const refreshBadge = (): void => {
    if (button) setBadge(button, readPending());
  };
  const expanded = (open: boolean): void => {
    button?.setAttribute('aria-expanded', String(open));
  };

  // Opt-in, so its code loads only when asked for. It's installed once
  // loaded, unless unmount() ran in the meantime.
  let errors: ConsoleModule.ConsoleErrors | undefined;
  const { consoleErrors } = options;
  if (consoleErrors) {
    import('./console-errors.ts').then(
      (mod) => {
        if (!signal.aborted) {
          errors = mod.captureConsoleErrors(consoleErrors === true ? 20 : consoleErrors, signal);
        }
      },
      (error: unknown) => {
        warn(`couldn't load console capture. ${String(error)}`);
      },
    );
  }

  const mirror = (pending: number): void => {
    writePending(pending);
    refreshBadge();
    // An open panel shows the count too (the only badge without a button).
    shown?.setPending(root, pending);
  };
  // Delivery loads only when there's something to send, so mounting stays
  // cheap; it finds the token itself. Its own outbox reports to the mirror
  // only: a report from it must not start another send.
  let sync: Promise<SyncModule.Sync | undefined> | undefined;
  const send = (): void => {
    sync ??= import('./sync.ts').then(
      (mod) =>
        signal.aborted
          ? undefined
          : mod.startSync({
              endpoint: options.endpoint ?? '/__field-notes',
              token: options.token,
              changed: mirror,
              signal,
            }),
      (error: unknown) => {
        sync = undefined;
        warn(`couldn't load delivery. ${String(error)}`);
        return undefined;
      },
    );
    void sync.then((started) => started?.kick());
  };

  // Loaded alongside the panel on the first open, not after it.
  let camera: Promise<typeof ScreenshotModule> | undefined;
  let screen: Promise<typeof DisplayModule> | undefined;
  const shoot = async (
    display = options.screenshot === 'display',
  ): Promise<Capture | undefined> => {
    if (options.screenshot === 'off') return undefined;
    try {
      if (display && canCaptureTab()) {
        const { captureDisplay } = await (screen ??= import('./display.ts'));
        const image = await captureDisplay(root, signal);
        if (image !== 'dom') {
          return {
            cloned: Promise.resolve(),
            image: Promise.resolve(image),
            cancel: () => undefined,
          };
        }
      }
      const { captureScreenshot } = await (camera ??= import('./screenshot.ts'));
      const capture = captureScreenshot(el);
      await Promise.race([
        capture.cloned,
        new Promise((resolve) => setTimeout(resolve, CLONE_WAIT_MS)),
      ]);
      return capture;
    } catch (error) {
      camera = screen = undefined;
      warn(`couldn't take a screenshot. ${String(error)}`);
      return undefined;
    }
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
      // Before anything takes focus, which can clear the page's selection.
      const selection = getSelection()?.toString();
      loading ??= import('./panel.ts');
      // Taken before the surface renders, so it isn't in the shot.
      const shot = shoot();
      let panel: Panel;
      try {
        panel = await loading;
      } catch (error) {
        loading = undefined;
        wanted = false; // nothing opened, so the next toggle() opens again
        warn(`couldn't load the panel. ${String(error)}`);
        void shot.then((capture) => capture?.cancel());
        return;
      }
      const capture = await shot;
      if (!stillWanted()) {
        capture?.cancel();
        return;
      }
      shown = panel;
      hook(options.onOpen);
      panel.showPanel(root, {
        surface,
        anchor: button && { rect: button.getBoundingClientRect(), corner },
        options,
        selection,
        shot: capture,
        // After a pick, the DOM screenshot: a second prompt would surprise.
        shoot: () => shoot(false),
        consoleErrors: () => errors?.snapshot(),
        pendingChanged: (pending: number) => {
          mirror(pending);
          if (pending && !exporting) send();
        },
        loadExport,
        signal,
        close: handle.close,
      });
      expanded(true);
    },
    close: () => {
      wanted = false;
      if (shown) {
        shown.hidePanel(root);
        shown = undefined;
        // Every close path ends here: once per onOpen.
        hook(options.onClose);
      }
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
      // A declared element is the page's: it's emptied, and its styles are
      // replaced by the next mount's.
      if (declared) root.replaceChildren();
      else el.remove();
      Reflect.deleteProperty(el, HANDLE_KEY);
    },
  };

  if (button) {
    button.addEventListener('click', () => void handle.toggle(), { signal });
    root.append(button);
    refreshBadge();
    // Other tabs share the outbox; their changes arrive as storage events.
    addEventListener(
      'storage',
      (event) => {
        if (event.key === PENDING_KEY || event.key === null) refreshBadge();
      },
      { signal },
    );
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

  // Notes left from an earlier visit.
  if (readPending() && !exporting) send();

  el[HANDLE_KEY] = handle;
  // A script tag in <head> can mount before <body> exists.
  if (!declared) ((document.body as HTMLElement | null) ?? document.documentElement).append(el);
  // Promoted once connected; older engines without popovers keep it fixed.
  if (button && 'showPopover' in button) button.showPopover();
  return handle;
}
