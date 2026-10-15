// A <field-notes> written into a page or a framework's template. While one
// is connected, it carries the widget, configured by its attributes; when
// the framework removes it, the widget goes with it, and another declared
// element on the page takes over. A lazy chunk: `defineFieldNotes()` in
// index.ts loads it, and hands it the mount. It imports nothing the entry has, which would split the
// entry's code into a chunk of its own.
import { readOptions } from './attributes.ts';
import type { FieldNotesHandle, FieldNotesOptions, Shell } from './mount.ts';

/** Mounts the widget onto `el`, with its attributes over `defineFieldNotes()`'s options. */
type MountOn = (attributes: FieldNotesOptions, el: Shell) => FieldNotesHandle;

// As element.ts has them: importing them would split them out of the entry.
const TAG = 'field-notes';
const HANDLE: symbol = Symbol.for('field-notes.handle');
const DECLARED: symbol = Symbol.for('field-notes.declared');

let scheduled = false;
let mountOn: MountOn | undefined;
/** Declared elements this copy of the widget mounted. */
const carrying = new Set<Shell>();
/** Declared elements unmounted through their handle: they stay empty. */
const retired = new WeakSet<Element>();
/** Elements connected or disconnected since the last reconcile. */
let moved = new WeakSet<Element>();
/**
 * Elements that reported being connected: a query of the document can't
 * find one inside a shadow root.
 */
const reported = new Set<Shell>();

const handleOf = (el: Element): FieldNotesHandle | undefined =>
  Reflect.get(el, HANDLE) as FieldNotesHandle | undefined;

/** The live mount on a `<field-notes>` the page has, wherever it is. */
const live = (): FieldNotesHandle | undefined =>
  [...document.querySelectorAll(TAG), ...reported].map(handleOf).find((handle) => handle?.active);

/**
 * Brings the page in line with its declared elements, once per task: a
 * framework swapping one for another, in either order, is settled in one go.
 * An element that was removed unmounts its widget, even if it's back: the
 * browser closed its button and surface as it left. Back in the page, it
 * carries a fresh one.
 */
function reconcile(): void {
  scheduled = false;
  const touched = moved;
  moved = new WeakSet();
  if (!mountOn) return;
  for (const el of carrying) {
    const handle = handleOf(el);
    if (!handle) {
      carrying.delete(el);
      retired.add(el);
    } else if (!el.isConnected || touched.has(el)) {
      carrying.delete(el);
      handle.unmount();
    }
  }
  for (const el of reported) if (!el.isConnected) reported.delete(el);
  if (live()) return;
  const el = [...document.querySelectorAll<Shell>(TAG), ...reported].find(
    (candidate) => !handleOf(candidate) && !retired.has(candidate),
  );
  if (!el) return;
  const handle = mountOn(
    readOptions((name) => el.getAttribute(name) ?? undefined),
    el,
  );
  if (handle.active) carrying.add(el);
}

/** Reconciles after the current task, once however often it's asked. */
const schedule = (): void => {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(reconcile);
};

/**
 * What the element calls: with itself when it's connected or disconnected,
 * or with nothing (`findMount()`) for the live mount.
 */
const report = (el?: Shell): FieldNotesHandle | undefined => {
  if (!el) return live();
  moved.add(el);
  if (el.isConnected) reported.add(el);
  schedule();
  return undefined;
};

/**
 * `defineFieldNotes()`, once this chunk has loaded: registers the element
 * (with `defineShell`), has it report being connected and disconnected, and
 * reconciles the page as it is now. The last call's `mount` is the one used.
 */
export function define(defineShell: () => string | undefined, mount: MountOn): void {
  if (typeof customElements === 'undefined') return;
  const shell = defineShell() ? undefined : customElements.get(TAG);
  // Registered by something else, or by a copy of the widget from before
  // declared elements: they'd never say they're connected.
  if (!shell || !('connectedCallback' in shell.prototype)) {
    console.warn(`[field-notes] <${TAG}> isn't this version's, so declared ones stay empty.`);
    return;
  }
  mountOn = mount;
  Reflect.set(shell, DECLARED, report);
  schedule();
}
