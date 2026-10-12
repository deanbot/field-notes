/**
 * True when keyboard input is going to an editable host element, in which
 * case the widget's hotkey must not fire (keyboard etiquette).
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLTextAreaElement) return !target.readOnly && !target.disabled;
  if (target instanceof HTMLInputElement) {
    const nonText = [
      'button',
      'checkbox',
      'radio',
      'range',
      'color',
      'file',
      'submit',
      'reset',
      'image',
    ];
    return !nonText.includes(target.type) && !target.readOnly && !target.disabled;
  }
  if (target instanceof HTMLSelectElement) return !target.disabled;
  return target instanceof HTMLElement && target.isContentEditable;
}
