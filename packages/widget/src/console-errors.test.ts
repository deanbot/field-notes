import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureConsoleErrors } from './console-errors.ts';

const realError = console.error;
const controllers: AbortController[] = [];

function start(limit = 20): { snapshot: () => string[]; stop: () => void } {
  const controller = new AbortController();
  controllers.push(controller);
  const capture = captureConsoleErrors(limit, controller.signal);
  return {
    snapshot: capture.snapshot,
    stop: () => {
      controller.abort();
    },
  };
}

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.abort();
  console.error = realError;
  window.onerror = null;
});

/** Stands in for the host's own console.error. */
function hostLogger(): ReturnType<typeof vi.fn> {
  const host = vi.fn();
  console.error = host;
  return host;
}

describe('captureConsoleErrors', () => {
  it('keeps console.error calls and still calls the original', () => {
    const host = hostLogger();
    const capture = start();
    console.error('boom', { code: 7 }, new Error('bad'));
    expect(host).toHaveBeenCalledWith('boom', { code: 7 }, expect.any(Error));
    const [entry] = capture.snapshot();
    expect(entry).toContain('boom {"code":7}');
    expect(entry).toContain('Error: bad');
  });

  it('records uncaught errors and unhandled rejections without replacing onerror', () => {
    hostLogger(); // the test runner logs these events through console.error too
    const capture = start();
    const onerror = vi.fn();
    window.onerror = onerror;
    window.dispatchEvent(
      new ErrorEvent('error', { message: 'Script error', error: new TypeError('x is undefined') }),
    );
    window.dispatchEvent(new ErrorEvent('error', { message: 'only a message' }));
    window.dispatchEvent(
      new PromiseRejectionEvent('unhandledrejection', {
        promise: Promise.resolve(),
        reason: 'nope',
      }),
    );
    expect(onerror).toHaveBeenCalledTimes(2);
    expect(capture.snapshot()).toEqual(
      expect.arrayContaining([
        expect.stringContaining('TypeError: x is undefined'),
        'only a message',
        'Unhandled rejection: nope',
      ]),
    );
  });

  it('keeps only the last N, each one truncated', () => {
    hostLogger();
    const capture = start(2);
    console.error('one');
    console.error('two');
    console.error('x'.repeat(5000));
    const entries = capture.snapshot();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toBe('two');
    expect(entries[1]).toHaveLength(1000);
  });

  it('copes with values that cannot be printed', () => {
    hostLogger();
    const capture = start();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    console.error(cyclic, Symbol('s'), 10n);
    expect(capture.snapshot()).toEqual(['[unprintable] Symbol(s) 10']);
  });

  it('restores the host console.error on stop', () => {
    const host = hostLogger();
    const capture = start();
    capture.stop();
    expect(console.error).toBe(host);
    window.dispatchEvent(new ErrorEvent('error', { message: 'after' }));
    expect(capture.snapshot()).toEqual([]);
  });

  it('stays a pass-through when the host wrapped console.error after it', () => {
    const host = hostLogger();
    const capture = start();
    const ours = console.error;
    const later = vi.fn((...args: unknown[]) => {
      ours(...args);
    });
    console.error = later;
    capture.stop();
    expect(console.error).toBe(later);
    console.error('still reaches the host');
    expect(host).toHaveBeenCalledWith('still reaches the host');
    expect(capture.snapshot()).toEqual([]);
  });

  it.each([0, -3, Number.NaN, 2.7])('takes a usable limit from %s', (limit) => {
    hostLogger();
    const capture = start(limit);
    for (let i = 0; i < 30; i++) console.error(String(i));
    const expected = Number.isNaN(limit) ? 20 : Math.max(1, Math.floor(limit));
    expect(capture.snapshot()).toHaveLength(expected);
  });
});
