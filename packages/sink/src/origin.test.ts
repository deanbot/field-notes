import { describe, expect, it } from 'vitest';
import { DEFAULT_ALLOWED_ORIGINS, isAllowedOrigin, isOriginPattern } from './origin.ts';

describe('isAllowedOrigin', () => {
  it('accepts https loopback too: an https dev server is as local', () => {
    expect(isAllowedOrigin('https://localhost:5173', DEFAULT_ALLOWED_ORIGINS)).toBe(true);
    expect(isAllowedOrigin('https://127.0.0.1:3000', DEFAULT_ALLOWED_ORIGINS)).toBe(true);
    expect(isAllowedOrigin('https://[::1]:8443', DEFAULT_ALLOWED_ORIGINS)).toBe(true);
  });

  it('accepts localhost on any port with the defaults', () => {
    expect(isAllowedOrigin('http://localhost:5173', DEFAULT_ALLOWED_ORIGINS)).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:3000', DEFAULT_ALLOWED_ORIGINS)).toBe(true);
    expect(isAllowedOrigin('http://[::1]:8080', DEFAULT_ALLOWED_ORIGINS)).toBe(true);
    expect(isAllowedOrigin('http://localhost', DEFAULT_ALLOWED_ORIGINS)).toBe(true);
  });

  it('rejects other hosts, including look-alikes', () => {
    expect(isAllowedOrigin('http://evil.com', DEFAULT_ALLOWED_ORIGINS)).toBe(false);
    expect(isAllowedOrigin('http://localhost.evil.com:5173', DEFAULT_ALLOWED_ORIGINS)).toBe(false);
  });

  it('matches exact entries exactly', () => {
    const list = ['https://app.test:8443'];
    expect(isAllowedOrigin('https://app.test:8443', list)).toBe(true);
    expect(isAllowedOrigin('https://app.test:8444', list)).toBe(false);
  });

  it('rejects missing, malformed, or non-origin values', () => {
    expect(isAllowedOrigin(undefined, DEFAULT_ALLOWED_ORIGINS)).toBe(false);
    expect(isAllowedOrigin('null', DEFAULT_ALLOWED_ORIGINS)).toBe(false);
    expect(isAllowedOrigin('not a url', DEFAULT_ALLOWED_ORIGINS)).toBe(false);
    expect(isAllowedOrigin('http://localhost:5173/path', DEFAULT_ALLOWED_ORIGINS)).toBe(false);
  });
});

describe('isOriginPattern', () => {
  it('accepts origins and host:* entries, and nothing else', () => {
    for (const entry of [
      'http://app.test:3000',
      'https://app.test',
      'http://app.test:*',
      ...DEFAULT_ALLOWED_ORIGINS,
    ]) {
      expect(isOriginPattern(entry), entry).toBe(true);
    }
    for (const entry of [
      'app.test',
      'http://app.test/',
      'http://app.test:3000/x',
      '*',
      'http://*.test',
      '',
    ]) {
      expect(isOriginPattern(entry), entry).toBe(false);
    }
  });
});
