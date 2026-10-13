import {
  type FieldNotesHandle,
  type FieldNotesOptions,
  mountFieldNotes as mount,
} from './mount.ts';

export type { Enabled } from './activation.ts';
export { TAG_NAME } from './element.ts';
export { isEditableTarget } from './keyboard.ts';
export type { Corner, Offset } from './button.ts';
export type { Surface } from './panel.ts';
export type { FieldNotesHandle, FieldNotesOptions, Trigger } from './mount.ts';

/**
 * Adds the widget to the page. Nothing renders until it's opened, and the
 * panel code isn't loaded until then either.
 *
 * Mounting twice, including from two copies of the widget (script tag and
 * npm import), warns and returns the existing mount instead of throwing.
 * Where there's no DOM, or activation says no, it returns an inactive handle.
 */
export function mountFieldNotes(options?: FieldNotesOptions): FieldNotesHandle {
  // Here, not in mount.ts: the script-tag build leaves export mode's chunk out.
  return mount(options, () => import('./export.ts'));
}
