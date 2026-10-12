import { afterEach, describe, expect, it, vi } from 'vitest';
import { PENDING_KEY, readPending, writePending } from './pending.ts';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('pending mirror', () => {
  it('round-trips, and stores nothing for zero', () => {
    writePending(3);
    expect(readPending()).toBe(3);
    writePending(0);
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
    expect(readPending()).toBe(0);
  });

  it.each(['abc', '-2', '1.5', ''])('reads %j as zero', (raw) => {
    localStorage.setItem(PENDING_KEY, raw);
    expect(readPending()).toBe(0);
  });

  it('copes with storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(() => {
      writePending(2);
    }).not.toThrow();
    expect(readPending()).toBe(0);
  });
});
