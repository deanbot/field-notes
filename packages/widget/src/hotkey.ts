/** A parsed shortcut such as `Alt+Shift+F`. */
export interface Hotkey {
  readonly alt: boolean;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
  /** `KeyboardEvent.code` for keys matched by position, otherwise `KeyboardEvent.key`. */
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

// Printable keys by their US-layout position. Shift and macOS Alt change
// what these type (Shift+/ is `?`, Alt+. is `≥`), so they match by
// `KeyboardEvent.code`, never by `key`.
const PUNCTUATION = new Map([
  ['`', 'Backquote'],
  ['-', 'Minus'],
  ['=', 'Equal'],
  ['[', 'BracketLeft'],
  [']', 'BracketRight'],
  ['\\', 'Backslash'],
  [';', 'Semicolon'],
  ["'", 'Quote'],
  [',', 'Comma'],
  ['.', 'Period'],
  ['/', 'Slash'],
]);

// `KeyboardEvent.code` names that may be written as the key, any case.
const CODES = new Map(
  [
    ...PUNCTUATION.values(),
    'Space',
    ...'0123456789'.split('').map((d) => `Numpad${d}`),
    'NumpadAdd',
    'NumpadSubtract',
    'NumpadMultiply',
    'NumpadDivide',
    'NumpadDecimal',
  ].map((code) => [code.toLowerCase(), code]),
);

/**
 * Parses `Alt+Shift+F`-style text: any modifiers, then exactly one key.
 * Letters, digits, punctuation and `Space` match by physical key, as do
 * `KeyboardEvent.code` names (`Slash`, `KeyQ`). Other names (`F2`, `Escape`)
 * match by `KeyboardEvent.key`. Returns undefined when the text isn't a
 * shortcut, including a character with no key position to match.
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
  const code = codeFor(last);
  if (code) return { ...mods, code };
  // A single character we can't place on a key would never match.
  if (Array.from(last).length === 1) return undefined;
  return { ...mods, key: last.toLowerCase() };
}

function codeFor(key: string): string | undefined {
  // With Alt held, macOS reports letters as symbols too (Alt+Shift+F is `Ï`).
  const letter = /^(?:key)?([a-z])$/i.exec(key)?.[1];
  if (letter) return `Key${letter.toUpperCase()}`;
  const digit = /^(?:digit)?(\d)$/i.exec(key)?.[1];
  if (digit) return `Digit${digit}`;
  return PUNCTUATION.get(key) ?? CODES.get(key.toLowerCase());
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
