// The panel chunk: loaded on first open, never at mount. Lit lives here and
// only here; templates render into the shell's shadow root, and nothing in
// this chunk registers a custom element.
import { html, nothing, render } from 'lit/html.js';
import type { Corner } from './button.ts';
import { deliver } from './deliver.ts';
import { type Exporting, createDrawer } from './drawer.ts';
import { type FormDeps, createForm, resolveTypes } from './form.ts';
import type { LoadExport } from './mount.ts';
import { type Outbox, createOutbox } from './outbox.ts';

/** The layout the panel opens in. All of them share one form. */
export type Surface = 'popover' | 'sheet' | 'side';

export interface PanelView extends Pick<
  FormDeps,
  'options' | 'selection' | 'consoleErrors' | 'signal'
> {
  /** Hears the outbox's pending count: the stub mirrors it and updates the badge. */
  readonly pendingChanged: (pending: number) => void;
  readonly surface: Surface;
  /** Where the trigger button is, for the popover to anchor to. */
  readonly anchor?: { readonly rect: DOMRect; readonly corner: Corner } | undefined;
  readonly close: () => void;
  /** The export chunk, in the npm build. */
  readonly loadExport?: LoadExport | undefined;
}

/** How long the confirmation toast stays up. */
export const TOAST_MS = 3000;

// Every colour, the radius and the font can be set from the host with a
// `--field-notes-*` custom property (custom properties pass through
// `all: initial`). The defaults follow the user's light or dark preference.
const css = `
.surface {
  --_bg: var(--field-notes-bg, light-dark(#fff, #1e1e1e));
  --_fg: var(--field-notes-fg, light-dark(#1a1a1a, #f0f0f0));
  --_border: var(--field-notes-border, light-dark(#d0d7de, #3d444d));
  --_accent: var(--field-notes-accent, light-dark(#0969da, #4493f8));
  --_radius: var(--field-notes-radius, 8px);
  color-scheme: light dark;
  position: fixed;
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  inset: auto;
  max-width: none;
  max-height: none;
  overflow: auto;
  color: var(--_fg);
  background: var(--_bg);
  border: 1px solid var(--_border);
  font: 14px/1.4 var(--field-notes-font, system-ui, sans-serif);
  box-shadow: 0 4px 24px rgb(0 0 0 / 0.2);
}
.surface::backdrop { background: transparent; }
.popover {
  width: min(360px, calc(100vw - 16px));
  border-radius: var(--_radius);
}
.sheet {
  left: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  max-height: 40vh;
  border-width: 1px 0 0;
  border-radius: var(--_radius) var(--_radius) 0 0;
}
.side {
  top: 0;
  right: 0;
  bottom: 0;
  width: min(400px, 100vw);
  height: 100%;
  border-width: 0 0 0 1px;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 8px 8px 16px;
  border-bottom: 1px solid var(--_border);
}
h2 { margin: 0; font-size: 16px; font-weight: 600; }
.close {
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  font: 20px/1 inherit;
  color: inherit;
  background: transparent;
  cursor: pointer;
}
.close:focus-visible { outline: 2px solid var(--_accent); outline-offset: 1px; }
.body { display: grid; gap: 8px; padding: 12px 16px 16px; }
.label { font-size: 12px; font-weight: 600; }
textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 96px;
  padding: 8px;
  resize: vertical;
  font: inherit;
  color: inherit;
  background: transparent;
  border: 1px solid var(--_border);
  border-radius: 6px;
}
textarea[aria-invalid='true'] { border-color: var(--field-notes-error, light-dark(#cf222e, #f85149)); }
textarea:focus-visible, .chip input:focus-visible + span, .primary:focus-visible {
  outline: 2px solid var(--_accent);
  outline-offset: 1px;
}
.types { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; border: 0; }
.types legend { padding: 0; margin-bottom: 4px; }
.chip input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.chip span {
  display: inline-block;
  padding: 2px 10px;
  border: 1px solid var(--_border);
  border-radius: 999px;
  cursor: pointer;
}
.chip input:checked + span { color: var(--_bg); background: var(--_accent); border-color: var(--_accent); }
.error { margin: 0; min-height: 1em; font-size: 12px; color: var(--field-notes-error, light-dark(#cf222e, #f85149)); }
.actions { display: flex; align-items: center; justify-content: flex-end; gap: 12px; }
.hint { font-size: 12px; opacity: 0.75; }
.primary {
  padding: 6px 14px;
  font: inherit;
  font-weight: 600;
  color: var(--_bg);
  background: var(--_accent);
  border: 0;
  border-radius: 6px;
  cursor: pointer;
}
.primary:disabled { opacity: 0.6; cursor: default; }
header .link { margin-left: auto; }
.link {
  padding: 4px 6px;
  font: inherit;
  font-size: 13px;
  color: var(--_accent);
  background: transparent;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
}
.link:focus-visible { outline: 2px solid var(--_accent); outline-offset: 1px; }
.entries { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.entry { display: grid; gap: 4px; padding: 8px; border: 1px solid var(--_border); border-radius: 6px; }
.summary { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
.meta { margin: 0; font-size: 12px; opacity: 0.8; }
.warning { margin: 0; font-size: 12px; font-weight: 600; }
.actions > :first-child { margin-left: -6px; }
.actions .hint { margin-left: auto; }
.picked { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
select { font: inherit; color: inherit; background: var(--_bg); border: 1px solid var(--_border); border-radius: 6px; padding: 4px; }
.toast {
  --_bg: var(--field-notes-bg, light-dark(#fff, #1e1e1e));
  --_fg: var(--field-notes-fg, light-dark(#1a1a1a, #f0f0f0));
  color-scheme: light dark;
  position: fixed;
  inset: auto 0 24px;
  margin: 0 auto;
  width: max-content;
  max-width: calc(100vw - 32px);
  padding: 8px 14px;
  border: 0;
  border-radius: 6px;
  font: 14px/1.4 var(--field-notes-font, system-ui, sans-serif);
  color: var(--_bg);
  background: var(--_fg);
}
`;

// Per mount: the dialog and the toast render into separate containers, so
// closing the panel doesn't take the toast with it.
interface Hosts {
  readonly surface: HTMLElement;
  readonly toast: HTMLElement;
  /** One per mount; closed on unmount. */
  readonly outbox: Outbox;
  /** Pending notes, for the "My notes" button. */
  pending: number;
  /** Redraws the open panel, if any. */
  redraw?: (() => void) | undefined;
  timer?: ReturnType<typeof setTimeout>;
  /** Detaches the open form, so a submit still in flight can't touch the next one. */
  dispose?: (() => void) | undefined;
}
const hosts = new WeakMap<ShadowRoot, Hosts>();

function hostsFor(root: ShadowRoot, view: PanelView): Hosts {
  const found = hosts.get(root);
  if (found) return found;
  const surface = document.createElement('div');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  toast.popover = 'manual';
  root.append(surface, toast);
  const created: Hosts = {
    surface,
    toast,
    pending: 0,
    outbox: createOutbox(view.signal, (pending) => {
      created.pending = pending;
      view.pendingChanged(pending);
      created.redraw?.();
    }),
  };
  view.signal.addEventListener('abort', () => {
    clearTimeout(created.timer);
  });
  hosts.set(root, created);
  return created;
}

function showToast(target: Hosts, message: string): void {
  clearTimeout(target.timer);
  target.toast.textContent = message;
  // Shown last, so it sits above anything else in the top layer.
  if (target.toast.matches(':popover-open')) target.toast.hidePopover();
  target.toast.showPopover();
  target.timer = setTimeout(() => {
    target.toast.hidePopover();
  }, TOAST_MS);
}

let sheet: CSSStyleSheet | undefined;

// Repairs for a host's focus trap (focus-trap, modal libraries). The page
// behind our modal dialog is inert, so a trap can't pull focus back, but it
// may cancel what it sees in the capture phase. See
// docs/recipes/host-focus-trap.md for what still needs the host's help.

const FOCUSABLE = 'button, textarea, input, select, [tabindex]';

/** The dialog's Tab stops in order; one per radio group, as the browser does. */
function tabStops(dialog: HTMLDialogElement, backward: boolean): HTMLElement[] {
  const all = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.tabIndex >= 0 && !el.matches(':disabled') && el.checkVisibility(),
  );
  const groups = new Map<string, HTMLInputElement[]>();
  for (const el of all) {
    if (el instanceof HTMLInputElement && el.type === 'radio') {
      groups.set(el.name, [...(groups.get(el.name) ?? []), el]);
    }
  }
  return all.filter((el) => {
    if (!(el instanceof HTMLInputElement) || el.type !== 'radio') return true;
    const group = groups.get(el.name) ?? [];
    const stop = group.find((radio) => radio.checked) ?? (backward ? group.at(-1) : group[0]);
    return el === stop;
  });
}

/**
 * Tab that a host trap cancelled (it saw focus outside its container) moves
 * focus here instead, wrapping within the dialog. Native Tab is left alone.
 */
function repairTab(event: KeyboardEvent, dialog: HTMLDialogElement, root: ShadowRoot): void {
  if (event.key !== 'Tab' || !event.defaultPrevented) return;
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const stops = tabStops(dialog, event.shiftKey);
  if (!stops.length) return;
  const at = stops.indexOf(root.activeElement as HTMLElement);
  const step = event.shiftKey ? -1 : 1;
  const next = at < 0 ? (event.shiftKey ? stops.length - 1 : 0) : at + step;
  stops.at(next % stops.length)?.focus();
}

/** A click whose focus a host trap cancelled still focuses the control. */
function repairPointerFocus(event: MouseEvent): void {
  if (!event.defaultPrevented) return;
  const control = (event.target as Element).closest<HTMLElement>('textarea, input, select, button');
  if (control && !control.matches(':disabled')) control.focus();
}

/** Popover placement: beside the button's corner, clear of the button. */
function anchorTo(
  dialog: HTMLDialogElement,
  { rect, corner }: NonNullable<PanelView['anchor']>,
): void {
  const gap = 8; // from the button, and from the far edge of the viewport
  const { clientWidth, clientHeight } = document.documentElement;
  const [vertical, horizontal] = corner.split('-');
  // Only the space between the button and the far edge is available: the
  // popover scrolls inside that rather than running off screen.
  let room: number;
  if (vertical === 'bottom') {
    dialog.style.bottom = `${String(clientHeight - rect.top + gap)}px`;
    room = rect.top - 2 * gap;
  } else {
    dialog.style.top = `${String(rect.bottom + gap)}px`;
    room = clientHeight - rect.bottom - 2 * gap;
  }
  dialog.style.maxHeight = `${String(Math.max(room, 0))}px`;
  if (horizontal === 'right') dialog.style.right = `${String(clientWidth - rect.right)}px`;
  else dialog.style.left = `${String(rect.left)}px`;
}

export function showPanel(root: ShadowRoot, view: PanelView): void {
  if (!sheet) {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
  }
  if (!root.adoptedStyleSheets.includes(sheet)) {
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
  }
  const target = hostsFor(root, view);
  // A popover with no button to anchor to opens as a sheet.
  const surface = view.surface === 'popover' && !view.anchor ? 'sheet' : view.surface;
  const onClick = (event: MouseEvent): void => {
    // The page behind a modal dialog is inert, the trigger button included,
    // so a click outside the popover closes it. Backdrop clicks target the
    // dialog itself, but land outside its box.
    if (surface !== 'popover' || event.target !== event.currentTarget) return;
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const inside =
      event.clientX >= box.left &&
      event.clientX <= box.right &&
      event.clientY >= box.top &&
      event.clientY <= box.bottom;
    if (!inside) view.close();
  };

  /** Set while the dialog is collapsed for the element picker. */
  let picking: AbortController | undefined;

  // close fires after the dialog has gone: hidePanel() removes it at once.
  // A late event from a removed dialog mustn't close the next one, and the
  // picker's collapse isn't a close, even when the event comes after the
  // dialog is back.
  const onClose = (event: Event): void => {
    const dialog = event.currentTarget as HTMLDialogElement;
    if (dialog.isConnected && !dialog.open && !picking) view.close();
  };

  let disposed = false;
  target.dispose?.();
  target.dispose = () => {
    disposed = true;
    picking?.abort();
  };
  const redraw = (): void => {
    if (!disposed) draw();
  };
  target.redraw = redraw;
  let mode: 'form' | 'notes' = 'form';
  const { options } = view;
  const exporting: Exporting | undefined =
    options.mode === 'export'
      ? {
          load: view.loadExport,
          retention: (options.exportRetentionDays ?? 7) * 86_400_000,
          warnAt: {
            notes: options.storageWarning?.notes ?? 50,
            bytes: (options.storageWarning?.megabytes ?? 100) * 1_000_000,
          },
        }
      : undefined;
  const drawer = createDrawer({
    outbox: target.outbox,
    types: resolveTypes(options),
    redraw,
    exporting,
  });
  const showMode = (next: 'form' | 'notes'): void => {
    mode = next;
    if (mode === 'notes') void drawer.load();
    redraw();
    root.getElementById('field-notes-mode')?.focus();
  };
  // The page behind a modal dialog is inert, so the dialog closes while the
  // user picks, and the same form comes back with its text.
  const pick: FormDeps['pick'] = async () => {
    const dialog = target.surface.querySelector('dialog');
    if (picking || !dialog) return undefined;
    const controller = new AbortController();
    picking = controller;
    // A function: TypeScript would narrow the property across the awaits.
    const closed = (): boolean => controller.signal.aborted;
    try {
      const { pickElement } = await import('./picker.ts');
      if (closed()) return undefined;
      dialog.close();
      try {
        return await pickElement(root, controller.signal);
      } finally {
        if (!closed()) {
          dialog.showModal();
          caretToEnd();
        }
      }
    } finally {
      picking = undefined;
    }
  };
  const caretToEnd = (): void => {
    // A restored draft continues where it left off; WebKit would put the caret first.
    const text = root.getElementById('field-notes-text');
    if (text instanceof HTMLTextAreaElement)
      text.setSelectionRange(text.value.length, text.value.length);
  };
  const form = createForm({
    ...view,
    pick,
    deliver: (note) => deliver(note, target.outbox),
    redraw,
    focusText: () => {
      root.getElementById('field-notes-text')?.focus();
    },
    submitted: () => {
      // A delivery that finished after its panel closed still confirms, but
      // leaves the current panel open.
      if (!disposed) view.close();
      showToast(target, 'Note added');
    },
  });
  const myNotes = (): string =>
    target.pending
      ? `My notes (${String(target.pending)} ${exporting ? 'not exported' : 'not sent'})`
      : 'My notes';
  const draw = (): void => {
    render(
      html`<dialog
        class="surface ${surface}"
        aria-labelledby="field-notes-title"
        @close=${onClose}
        @click=${onClick}
        @keydown=${(event: KeyboardEvent) => {
          // Esc closes this dialog (natively); it isn't the host's Esc.
          if (event.key === 'Escape') event.stopPropagation();
          repairTab(event, event.currentTarget as HTMLDialogElement, root);
          if (mode === 'form') form.keydown(event);
        }}
        @mousedown=${repairPointerFocus}
      >
        <header>
          <h2 id="field-notes-title">Field notes</h2>
          ${
            mode === 'form'
              ? html`<button
                  type="button"
                  id="field-notes-mode"
                  class="link"
                  @click=${() => {
                    showMode('notes');
                  }}
                >
                  ${myNotes()}
                </button>`
              : html`<button
                  type="button"
                  id="field-notes-mode"
                  class="link"
                  @click=${() => {
                    showMode('form');
                  }}
                >
                  New note
                </button>`
          }
          <button type="button" class="close" aria-label="Close" @click=${view.close}>×</button>
        </header>
        ${mode === 'form' ? form.template() : drawer.template()}
      </dialog>`,
      target.surface,
    );
  };
  draw();
  const dialog = target.surface.querySelector('dialog');
  if (!dialog) return;
  if (surface === 'popover' && view.anchor) anchorTo(dialog, view.anchor);
  // Modal: the top layer (above host stacking contexts and the trigger
  // button, which was shown earlier), the page inert, Esc to close, and
  // focus handed back to whatever had it when the dialog closes.
  dialog.showModal();
  caretToEnd();
  // Recount from IndexedDB: corrects a stale badge, and fills in the count
  // when there's no button to show it on.
  // The count arrives through the outbox's change callback.
  target.outbox.pendingCount().catch((error: unknown) => {
    console.warn('[field-notes] could not read the outbox.', error);
  });
}

/** A pending count from elsewhere (background delivery), for the header. */
export function setPending(root: ShadowRoot, pending: number): void {
  const target = hosts.get(root);
  if (!target || target.pending === pending) return;
  target.pending = pending;
  target.redraw?.();
}

export function hidePanel(root: ShadowRoot): void {
  const target = hosts.get(root);
  if (!target) return;
  target.dispose?.();
  target.dispose = undefined;
  target.redraw = undefined;
  const dialog = target.surface.querySelector('dialog');
  if (dialog?.open) dialog.close();
  render(nothing, target.surface);
}
