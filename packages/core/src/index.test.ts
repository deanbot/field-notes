import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, slugify } from './index.ts';

describe('slugify', () => {
  it('lowercases and hyphenates words', () => {
    expect(slugify('Checkout Button Misaligned')).toBe('checkout-button-misaligned');
  });

  it('strips diacritics and punctuation', () => {
    expect(slugify('Café — "menu" isn’t aligned!')).toBe('cafe-menu-isn-t-aligned');
  });

  it('never produces path separators or traversal segments', () => {
    expect(slugify('../../etc/passwd')).toBe('etc-passwd');
  });

  it('truncates long text without a trailing hyphen', () => {
    const slug = slugify('word '.repeat(40));
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('falls back when nothing usable remains', () => {
    expect(slugify('')).toBe('note');
    expect(slugify('!!!')).toBe('note');
  });
});

describe('SCHEMA_VERSION', () => {
  it('starts at 1', () => {
    expect(SCHEMA_VERSION).toBe(1);
  });
});
