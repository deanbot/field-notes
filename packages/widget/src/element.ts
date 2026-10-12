/** The only name the widget registers in the global custom element registry. */
export const TAG_NAME = 'field-notes';

/**
 * Where a mounted element keeps its handle. `Symbol.for` makes the key shared
 * by every copy of the widget on a page (script tag and npm import), so a
 * second copy finds the first one's mount and reuses it.
 */
export const HANDLE_KEY: unique symbol = Symbol.for('field-notes.handle');

/** Marks the element class this package registers, to tell it from a stranger's. */
const SHELL_KEY: unique symbol = Symbol.for('field-notes.shell');

/**
 * Registers `<field-notes>` unless something already has. The element is an
 * empty shell: all behaviour lives in the mount, so an element registered by
 * another copy of the widget, of any version, works just as well.
 *
 * Returns a warning when the tag belongs to something else.
 */
export function defineShell(): string | undefined {
  const existing = customElements.get(TAG_NAME);
  if (!existing) {
    // Declared here, not at module scope, so importing the package where
    // HTMLElement doesn't exist (server rendering, Node) is safe.
    class FieldNotesElement extends HTMLElement {
      static readonly [SHELL_KEY] = true;
    }
    customElements.define(TAG_NAME, FieldNotesElement);
    return undefined;
  }
  if (SHELL_KEY in existing) return undefined;
  return `<${TAG_NAME}> is already defined by something else; reusing it.`;
}
