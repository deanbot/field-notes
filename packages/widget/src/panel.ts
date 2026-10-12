// The panel chunk: loaded on first open, never at mount. Lit lives here and
// only here; templates render into the shell's shadow root, and nothing in
// this chunk registers a custom element.
import { html, nothing, render } from 'lit/html.js';
import type { Corner } from './button.ts';
import { type FormDeps, createForm } from './form.ts';

/** The layout the panel opens in. All of them share one form. */
export type Surface = 'popover' | 'sheet' | 'side';

export interface PanelView extends Pick<
  FormDeps,
  'options' | 'selection' | 'consoleErrors' | 'deliver' | 'signal'
> {
  readonly surface: Surface;
  /** Where the trigger button is, for the popover to anchor to. */
  readonly anchor?: { readonly rect: DOMRect; readonly corner: Corner } | undefined;
  readonly close: () => void;
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
  timer?: ReturnType<typeof setTimeout>;
}
const hosts = new WeakMap<ShadowRoot, Hosts>();

function hostsFor(root: ShadowRoot, signal: AbortSignal): Hosts {
  let found = hosts.get(root);
  if (found) return found;
  const surface = document.createElement('div');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  toast.popover = 'manual';
  root.append(surface, toast);
  found = { surface, toast };
  const created = found;
  signal.addEventListener('abort', () => {
    clearTimeout(created.timer);
  });
  hosts.set(root, found);
  return found;
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
  const target = hostsFor(root, view.signal);
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

  // close fires after the dialog has gone: hidePanel() removes it at once.
  // A late event from a removed dialog mustn't close the next one.
  const onClose = (event: Event): void => {
    if ((event.currentTarget as Element).isConnected) view.close();
  };

  const form = createForm({
    ...view,
    redraw: () => {
      draw();
    },
    focusText: () => {
      root.getElementById('field-notes-text')?.focus();
    },
    submitted: () => {
      view.close();
      showToast(target, 'Note added');
    },
  });
  const draw = (): void => {
    render(
      html`<dialog
        class="surface ${surface}"
        aria-labelledby="field-notes-title"
        @close=${onClose}
        @click=${onClick}
        @keydown=${form.keydown}
      >
        <header>
          <h2 id="field-notes-title">Field notes</h2>
          <button type="button" class="close" aria-label="Close" @click=${view.close}>×</button>
        </header>
        ${form.template()}
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
}

export function hidePanel(root: ShadowRoot): void {
  const target = hosts.get(root);
  if (!target) return;
  const dialog = target.surface.querySelector('dialog');
  if (dialog?.open) dialog.close();
  render(nothing, target.surface);
}
