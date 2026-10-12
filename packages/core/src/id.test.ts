import { describe, expect, it } from 'vitest';
import { ulid } from './id.ts';

describe('ulid', () => {
  it('is 26 Crockford base32 characters', () => {
    expect(ulid()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('encodes the timestamp so ids sort by time', () => {
    expect(ulid(0).slice(0, 10)).toBe('0000000000');
    expect(ulid(2 ** 48 - 1).slice(0, 10)).toBe('7ZZZZZZZZZ');
    expect(ulid(1_700_000_000_000).slice(0, 10)).toBe('01HF7YAT00');
    expect(ulid(1000) < ulid(2000)).toBe(true);
  });

  it('is random after the timestamp', () => {
    const ids = new Set(Array.from({ length: 100 }, () => ulid(0)));
    expect(ids.size).toBe(100);
  });

  it.each([-1, 2 ** 48, 1.5, Number.NaN])('rejects timestamp %s', (now) => {
    expect(() => ulid(now)).toThrow(RangeError);
  });
});
