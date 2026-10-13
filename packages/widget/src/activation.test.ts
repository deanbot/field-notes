import { afterEach, describe, expect, it, vi } from 'vitest';
import { ENABLED_KEY, isDevBuild, isEnabled } from './activation.ts';

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

describe("isEnabled('query')", () => {
  const page = location.href;
  /** Opens "the page" with this query string, without reloading. */
  const visit = (search: string): void => {
    const url = new URL(page);
    url.search = search;
    history.replaceState(null, '', url);
  };

  afterEach(() => {
    vi.restoreAllMocks();
    history.replaceState(null, '', page);
    localStorage.removeItem(ENABLED_KEY);
  });

  it('is off until asked, in a dev build too', () => {
    visit('');
    expect(isEnabled('query', true)).toBe(false);
    expect(isEnabled('query', false)).toBe(false);
  });

  it('turns on with ?field-notes=1, and stays on for later pages, in any build', () => {
    visit('?a=b&field-notes=1');
    expect(isEnabled('query', false)).toBe(true);
    visit('');
    expect(isEnabled('query', false)).toBe(true);
    visit('?field-notes=yes');
    expect(isEnabled('query', false)).toBe(true);
  });

  it('turns off with ?field-notes=0, and forgets', () => {
    visit('?field-notes=1');
    isEnabled('query', false);
    visit('?field-notes=0');
    expect(isEnabled('query', false)).toBe(false);
    visit('');
    expect(isEnabled('query', false)).toBe(false);
    expect(localStorage.getItem(ENABLED_KEY)).toBeNull();
  });

  it("doesn't read the query for 'auto'", () => {
    visit('?field-notes=1');
    expect(isEnabled('auto', false)).toBe(false);
    visit('?field-notes=0');
    expect(isEnabled('auto', true)).toBe(true);
    expect(localStorage.getItem(ENABLED_KEY)).toBeNull();
  });

  it('goes by the URL alone when storage throws', () => {
    for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
      vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new DOMException('blocked', 'SecurityError');
      });
    }
    visit('?field-notes=1');
    expect(isEnabled('query', false)).toBe(true);
    visit('');
    expect(isEnabled('query', false)).toBe(false);
    visit('?field-notes=0');
    expect(isEnabled('query', false)).toBe(false);
  });
});

describe('isDevBuild', () => {
  it('is true outside a production build', () => {
    expect(isDevBuild()).toBe(true);
  });
});
