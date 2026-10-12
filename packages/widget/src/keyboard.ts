/**
 * True when keyboard input is going to an editable host element, in which
 * case the widget's hotkey must not fire (keyboard etiquette).
 *
 * Pass the event's `composedPath()[0]`. Behind a closed shadow root that is
 * the shadow host, a custom element whose focused field can't be seen, so it
 * counts as editable: better to miss a hotkey than to steal a keystroke.
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
  if (target.localName.includes('-') && !target.shadowRoot) return true;
  return target instanceof HTMLElement && target.isContentEditable;
}
