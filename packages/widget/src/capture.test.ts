import { NoteSchema } from '@field-notes/core/note';
import { type MockInstance, afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_SELECTION, buildNote, resolveAuthor, resolveContext, toContext } from './capture.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

const quiet = (): MockInstance<typeof console.warn> =>
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);

describe('buildNote', () => {
  it('builds a note that validates against the core schema', () => {
    const now = new Date('2026-10-12T10:00:00.000Z');
    const note = buildNote({
      body: 'The button is misaligned',
      type: 'bug',
      author: 'Sam',
      environment: 'local',
      selection: 'Place order',
      context: { appVersion: '1.4.0' },
      consoleErrors: ['TypeError: x is undefined'],
      now,
    });
    expect(NoteSchema.safeParse(note).success).toBe(true);
    expect(note).toMatchObject({
      schema: 1,
      status: 'open',
      created: '2026-10-12T10:00:00.000Z',
      type: 'bug',
      author: 'Sam',
      environment: 'local',
      url: location.href,
      route: location.pathname,
      title: document.title,
      userAgent: navigator.userAgent,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      selection: 'Place order',
      context: { appVersion: '1.4.0' },
      consoleErrors: ['TypeError: x is undefined'],
      body: 'The button is misaligned',
    });
    expect(['light', 'dark']).toContain(note.colorScheme);
    expect(note.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('leaves out what is empty', () => {
    const note = buildNote({ body: 'x', environment: 'local', selection: '', consoleErrors: [] });
    for (const key of ['type', 'author', 'selection', 'context', 'consoleErrors']) {
      expect(note).not.toHaveProperty(key);
    }
  });

  it('records the referrer only when there is one', () => {
    const note = buildNote({ body: 'x', environment: 'e' });
    if (document.referrer) expect(note.referrer).toBe(document.referrer);
    else expect(note).not.toHaveProperty('referrer');
  });

  it('caps the selection', () => {
    const note = buildNote({ body: 'x', environment: 'e', selection: 'a'.repeat(5000) });
    expect(note.selection).toHaveLength(MAX_SELECTION);
  });

  it('refuses a note the schema rejects', () => {
    expect(() => buildNote({ body: 'x', environment: 'e', type: '' })).not.toThrow();
    expect(() => buildNote({ body: 'x', environment: 'e', now: new Date(Number.NaN) })).toThrow();
  });
});

describe('toContext', () => {
  it('keeps plain data', () => {
    expect(toContext({ a: 1, b: { c: [true] } })).toEqual({ a: 1, b: { c: [true] } });
  });

  it.each([
    ['null', null],
    ['an array', [1]],
    ['a string', 'x'],
  ])('drops %s', (_, value) => {
    const warn = quiet();
    expect(toContext(value)).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('drops data that cannot be serialised', () => {
    const warn = quiet();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(toContext(cyclic)).toBeUndefined();
    expect(toContext({ n: 10n })).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('strips functions and undefined', () => {
    expect(toContext({ f: () => 1, u: undefined, k: 'v' })).toEqual({ k: 'v' });
  });
});

describe('resolveContext', () => {
  const signal = (): AbortSignal => new AbortController().signal;

  it('resolves sync and async results', async () => {
    await expect(resolveContext(() => ({ a: 1 }), signal())).resolves.toEqual({ a: 1 });
    await expect(resolveContext(() => Promise.resolve({ b: 2 }), signal())).resolves.toEqual({
      b: 2,
    });
    await expect(resolveContext(undefined, signal())).resolves.toBeUndefined();
  });

  it('settles without it when the callback throws or rejects', async () => {
    const warn = quiet();
    const thrown = resolveContext(() => {
      throw new Error('boom');
    }, signal());
    await expect(thrown).resolves.toBeUndefined();
    await expect(resolveContext(() => Promise.reject(new Error('no')), signal())).resolves.toBe(
      undefined,
    );
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('settles without it when the callback is too slow', async () => {
    const warn = quiet();
    const never = new Promise(() => undefined);
    await expect(resolveContext(() => never, signal(), 20)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('took over 20 ms'));
  });

  it('settles at once and clears its timer when aborted', async () => {
    const controller = new AbortController();
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    const pending = resolveContext(() => new Promise(() => undefined), controller.signal, 60_000);
    controller.abort();
    await expect(pending).resolves.toBeUndefined();
    expect(clear).toHaveBeenCalled();
  });

  it('settles at once when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      resolveContext(() => new Promise(() => undefined), controller.signal, 60_000),
    ).resolves.toBeUndefined();
  });
});

describe('resolveAuthor', () => {
  it('takes a string or a function', () => {
    expect(resolveAuthor('Sam')).toBe('Sam');
    expect(resolveAuthor(() => 'Alex')).toBe('Alex');
    expect(resolveAuthor(undefined)).toBeUndefined();
  });

  it('goes without when the function throws or returns a non-string', () => {
    const warn = quiet();
    expect(
      resolveAuthor(() => {
        throw new Error('x');
      }),
    ).toBeUndefined();
    expect(resolveAuthor((() => 42) as unknown as () => string)).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });
});
