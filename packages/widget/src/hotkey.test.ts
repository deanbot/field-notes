import { describe, expect, it } from 'vitest';
import { matchesHotkey, parseHotkey } from './hotkey.ts';

const none = { alt: false, ctrl: false, meta: false, shift: false };

describe('parseHotkey', () => {
  it.each([
    ['Alt+Shift+F', { ...none, alt: true, shift: true, code: 'KeyF' }],
    ['ctrl + 1', { ...none, ctrl: true, code: 'Digit1' }],
    ['Cmd+Option+n', { ...none, meta: true, alt: true, code: 'KeyN' }],
    ['Control+F2', { ...none, ctrl: true, key: 'f2' }],
    ['Ctrl+Shift+/', { ...none, ctrl: true, shift: true, code: 'Slash' }],
    ['Alt+.', { ...none, alt: true, code: 'Period' }],
    ['Ctrl+Space', { ...none, ctrl: true, code: 'Space' }],
    ['Alt+Slash', { ...none, alt: true, code: 'Slash' }],
    ['Alt+keyq', { ...none, alt: true, code: 'KeyQ' }],
    ['Shift+Numpad1', { ...none, shift: true, code: 'Numpad1' }],
    ['Escape', { ...none, key: 'escape' }],
  ])('%s', (text, expected) => {
    expect(parseHotkey(text)).toEqual(expected);
  });

  it.each(['', 'Alt+', 'Alt+Alt+F', 'Hyper+F', 'constructor+F', 'Alt+é', 'Ctrl+§'])(
    'rejects %j',
    (text) => {
      expect(parseHotkey(text)).toBeUndefined();
    },
  );
});

describe('matchesHotkey', () => {
  const hotkey = parseHotkey('Alt+Shift+F');
  if (!hotkey) throw new Error('unparsed');
  const press = (init: KeyboardEventInit): boolean =>
    matchesHotkey(hotkey, new KeyboardEvent('keydown', init));

  it('matches letters by physical key, whatever character they type', () => {
    expect(press({ code: 'KeyF', key: 'Ï', altKey: true, shiftKey: true })).toBe(true);
  });

  it('needs exactly the configured modifiers', () => {
    expect(press({ code: 'KeyF', key: 'F', shiftKey: true })).toBe(false);
    expect(press({ code: 'KeyF', key: 'F', altKey: true, shiftKey: true, ctrlKey: true })).toBe(
      false,
    );
    expect(press({ code: 'KeyG', key: 'G', altKey: true, shiftKey: true })).toBe(false);
  });

  it('matches punctuation and Space by physical key, whatever Shift or Alt types', () => {
    const slash = parseHotkey('Ctrl+Shift+/');
    const space = parseHotkey('Ctrl+Space');
    const period = parseHotkey('Alt+.');
    if (!slash || !space || !period) throw new Error('unparsed');
    const ev = (init: KeyboardEventInit): KeyboardEvent => new KeyboardEvent('keydown', init);
    expect(
      matchesHotkey(slash, ev({ code: 'Slash', key: '?', ctrlKey: true, shiftKey: true })),
    ).toBe(true);
    expect(matchesHotkey(space, ev({ code: 'Space', key: ' ', ctrlKey: true }))).toBe(true);
    expect(matchesHotkey(period, ev({ code: 'Period', key: '≥', altKey: true }))).toBe(true);
  });

  it('matches other keys by key, ignoring case', () => {
    const f2 = parseHotkey('F2');
    if (!f2) throw new Error('unparsed');
    expect(matchesHotkey(f2, new KeyboardEvent('keydown', { key: 'F2', code: 'F2' }))).toBe(true);
    expect(matchesHotkey(f2, new KeyboardEvent('keydown', { key: 'F3', code: 'F3' }))).toBe(false);
  });
});
