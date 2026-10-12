// The floating trigger button. Part of the activation stub, so plain DOM.

export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** Distance from the corner in px: one number for both edges, or each edge. */
export type Offset = number | { readonly x: number; readonly y: number };

export const BUTTON_CSS = `
.trigger {
  position: fixed;
  inset: auto;
  margin: 0;
  box-sizing: border-box;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  overflow: visible;
  color: var(--field-notes-button-fg, #fff);
  background: var(--field-notes-button-bg, var(--field-notes-accent, #0969da));
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.3);
  cursor: pointer;
}
.trigger:focus-visible { outline: 2px solid var(--field-notes-accent, #0969da); outline-offset: 2px; }
`;

// A pencil. Built with DOM calls, not innerHTML, which hosts enforcing
// Trusted Types reject.
function icon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  const path = document.createElementNS(ns, 'path');
  const attrs: [string, string][] = [
    ['width', '20'],
    ['height', '20'],
    ['viewBox', '0 0 24 24'],
    ['aria-hidden', 'true'],
  ];
  for (const [name, value] of attrs) {
    svg.setAttribute(name, value);
  }
  path.setAttribute('fill', 'currentColor');
  path.setAttribute(
    'd',
    'M3 17.25V21h3.75L17.8 9.94l-3.75-3.75zM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z',
  );
  svg.append(path);
  return svg;
}

export function createButton(corner: Corner, offset: Offset): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'trigger';
  button.part = 'button';
  button.setAttribute('aria-label', 'Field notes');
  button.setAttribute('aria-expanded', 'false');
  button.append(icon());
  const { x, y } = typeof offset === 'number' ? { x: offset, y: offset } : offset;
  const [vertical, horizontal] = corner.split('-') as ['top' | 'bottom', 'left' | 'right'];
  button.style.setProperty(vertical, `${String(y)}px`);
  button.style.setProperty(horizontal, `${String(x)}px`);
  // The top layer keeps it above host stacking contexts without a z-index.
  button.popover = 'manual';
  return button;
}
