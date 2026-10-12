import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDraft, loadDraft, saveDraft } from './drafts.ts';

const KEY = 'field-notes:draft';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('drafts', () => {
  it('round-trips', () => {
    saveDraft({ text: 'half a thought', type: 'idea' });
    expect(loadDraft()).toEqual({ text: 'half a thought', type: 'idea' });
    clearDraft();
    expect(loadDraft()).toBeUndefined();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('removes an empty draft rather than storing it', () => {
    saveDraft({ text: 'x' });
    saveDraft({ text: '' });
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it.each([
    ['not JSON', '{'],
    ['the wrong shape', JSON.stringify({ text: 1 })],
    ['a bad type', JSON.stringify({ text: 'a', type: 3 })],
    ['null', 'null'],
  ])('ignores %s', (_, raw) => {
    localStorage.setItem(KEY, raw);
    expect(loadDraft()).toBeUndefined();
  });

  it('works on when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(() => {
      saveDraft({ text: 'x' });
      clearDraft();
    }).not.toThrow();
    expect(loadDraft()).toBeUndefined();
  });
});
