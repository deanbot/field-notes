/** A parsed shortcut such as `Alt+Shift+F`. */
export interface Hotkey {
  readonly alt: boolean;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
  /** `KeyboardEvent.code` for letters and digits, otherwise `KeyboardEvent.key`. */
  readonly code?: string | undefined;
  readonly key?: string | undefined;
}

type Modifier = 'alt' | 'ctrl' | 'meta' | 'shift';

const MODIFIERS = new Map<string, Modifier>([
  ['alt', 'alt'],
  ['option', 'alt'],
  ['ctrl', 'ctrl'],
  ['control', 'ctrl'],
  ['meta', 'meta'],
  ['cmd', 'meta'],
  ['shift', 'shift'],
]);

/**
 * Parses `Alt+Shift+F`-style text: any modifiers, then exactly one key.
 * Returns undefined when the text isn't a shortcut.
 */
export function parseHotkey(text: string): Hotkey | undefined {
  const parts = text.split('+').map((part) => part.trim());
  const last = parts.pop();
  if (!last) return undefined;
  const mods = { alt: false, ctrl: false, meta: false, shift: false };
  for (const part of parts) {
    const mod = MODIFIERS.get(part.toLowerCase());
    if (!mod || mods[mod]) return undefined;
    mods[mod] = true;
  }
  // Letters and digits match by physical key: with Alt held, macOS reports
  // `event.key` as a symbol (Alt+Shift+F is `Ï`).
  if (/^[a-z]$/i.test(last)) return { ...mods, code: `Key${last.toUpperCase()}` };
  if (/^\d$/.test(last)) return { ...mods, code: `Digit${last}` };
  return { ...mods, key: last.toLowerCase() };
}

export function matchesHotkey(hotkey: Hotkey, event: KeyboardEvent): boolean {
  return (
    event.altKey === hotkey.alt &&
    event.ctrlKey === hotkey.ctrl &&
    event.metaKey === hotkey.meta &&
    event.shiftKey === hotkey.shift &&
    (hotkey.code ? event.code === hotkey.code : event.key.toLowerCase() === hotkey.key)
  );
}
