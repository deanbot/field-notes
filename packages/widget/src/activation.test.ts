import { describe, expect, it, vi } from 'vitest';
import { isDevBuild, isEnabled } from './activation.ts';

describe('isEnabled', () => {
  it.each([
    ['auto', true, true],
    ['auto', false, false],
    [true, false, true],
    [false, true, false],
  ] as const)('%s in a dev=%s build → %s', (enabled, dev, expected) => {
    expect(isEnabled(enabled, dev)).toBe(expected);
  });

  it('asks a function, whatever the build', () => {
    expect(isEnabled(() => true, false)).toBe(true);
    expect(isEnabled(() => false, true)).toBe(false);
  });

  it('only takes true from a function', () => {
    expect(isEnabled((() => 'yes') as unknown as () => boolean, true)).toBe(false);
  });

  it('stays off and warns when the function throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(
      isEnabled(() => {
        throw new Error('boom');
      }, true),
    ).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe('isDevBuild', () => {
  it('is true outside a production build', () => {
    expect(isDevBuild()).toBe(true);
  });
});
