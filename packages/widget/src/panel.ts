// The panel chunk: loaded on first open, never at mount. Lit lives here and
// only here; templates render into the shell's shadow root, and nothing in
// this chunk registers a custom element.
import { html, nothing, render } from 'lit/html.js';

export interface PanelView {
  readonly close: () => void;
}

const css = `
.panel {
  position: fixed;
  inset: auto 16px 16px auto;
  box-sizing: border-box;
  min-width: 280px;
  padding: 12px 16px;
  border-radius: 8px;
  font: 14px/1.4 system-ui, sans-serif;
  color: #1a1a1a;
  background: #fff;
  box-shadow: 0 4px 24px rgb(0 0 0 / 0.2);
}
h2 { margin: 0 0 8px; font-size: 16px; }
`;

let sheet: CSSStyleSheet | undefined;

export function showPanel(root: ShadowRoot, view: PanelView): void {
  if (!sheet) {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
  }
  if (!root.adoptedStyleSheets.includes(sheet)) {
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
  }
  render(
    html`<section class="panel" role="dialog" aria-label="Field notes">
      <h2>Field notes</h2>
      <button type="button" @click=${view.close}>Close</button>
    </section>`,
    root,
  );
}

export function hidePanel(root: ShadowRoot): void {
  render(nothing, root);
}
