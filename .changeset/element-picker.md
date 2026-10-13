---
'field-notes': minor
---

Add **Pick element** to the form. The panel steps aside, and the element under the pointer is outlined and labelled (tag and text) before you pick it. ↑/↓ or Alt+wheel climb to the parent and back, ←/→ move between siblings, a click or Enter picks, and Esc cancels; from the keyboard alone, picking starts at the element that had focus. The note records `element: { selector, tag, text, ariaLabel, rect }`. The selector prefers an `id`, a test id (`data-testid` and the like), `aria-label` or `role` over class names, and leaves out hashed or generated names (CSS modules, CSS-in-JS, React ids). Shadow roots, iframes and canvases are picked whole. Text inside `[data-field-notes-mask]` is never recorded. The picker loads on first use.
