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
 * Where `defineFieldNotes()` leaves, on the registered class, what an element
 * calls with itself when it's connected or disconnected. Called with nothing,
 * it returns the live declared mount, which a query of the document can't
 * find inside a shadow root. Shared like `HANDLE_KEY`, so it works whichever
 * copy registered the class.
 */
const DECLARED_KEY: unique symbol = Symbol.for('field-notes.declared');

type Declared = Record<typeof DECLARED_KEY, ((el?: HTMLElement) => unknown) | undefined>;

export const callDeclared = (el?: HTMLElement): unknown =>
  // The hook may be missing; the rule misreads a symbol key's `undefined`.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  (customElements.get(TAG_NAME) as Declared | undefined)?.[DECLARED_KEY]?.(el);

/**
 * Registers `<field-notes>` unless something already has. The element is a
 * shell: all behaviour lives in the mount, so an element registered by
 * another copy of the widget works just as well. It only reports being
 * connected and disconnected, for `defineFieldNotes()`.
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
      connectedCallback(): void {
        callDeclared(this);
      }
      disconnectedCallback(): void {
        callDeclared(this);
      }
    }
    customElements.define(TAG_NAME, FieldNotesElement);
    return undefined;
  }
  if (SHELL_KEY in existing) return undefined;
  return `<${TAG_NAME}> is already defined by something else; reusing it.`;
}
