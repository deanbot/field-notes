// Opt-in capture of the page's recent errors. Its own lazy chunk, loaded at
// mount only when `consoleErrors` is set. It chains to the host instead of
// replacing anything: console.error is wrapped and still calls the original,
// and window errors are observed with addEventListener, never `onerror`.

/** Longest single entry kept, in characters. */
const MAX_ENTRY = 1000;

export interface ConsoleErrors {
  /** The last errors, oldest first. */
  readonly snapshot: () => string[];
}

function describe(value: unknown): string {
  try {
    if (typeof value === 'string') return value;
    if (value instanceof Error) {
      // Chromium's stack starts with this header, built as Error's toString
      // builds it; WebKit's and Firefox's are frames only, whose URLs may
      // happen to contain a short message.
      const head = [value.name, value.message].filter(Boolean).join(': ');
      const stack = value.stack ?? '';
      return stack === head || stack.startsWith(`${head}\n`) ? stack : `${head}\n${stack}`.trim();
    }
    if (typeof value === 'object' && value !== null) return JSON.stringify(value);
    return String(value);
  } catch {
    return '[unprintable]';
  }
}

/**
 * Starts keeping the last `limit` errors. Aborting `signal` stops it: the
 * listeners go, and console.error is restored if it's still our wrapper. If
 * the host wrapped it after us, ours stays in its chain as a pass-through.
 */
export function captureConsoleErrors(limit: number, signal: AbortSignal): ConsoleErrors {
  const keep = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 20;
  const entries: string[] = [];
  const push = (text: string): void => {
    entries.push(text.slice(0, MAX_ENTRY));
    if (entries.length > keep) entries.splice(0, entries.length - keep);
  };

  const original = console.error;
  let active = true;
  const wrapper = function (this: unknown, ...args: unknown[]): void {
    if (active) push(args.map(describe).join(' '));
    original.apply(this, args);
  };
  console.error = wrapper;

  addEventListener(
    'error',
    (event) => {
      push(event.error === undefined ? event.message : describe(event.error));
    },
    { signal },
  );
  addEventListener(
    'unhandledrejection',
    (event) => {
      push(`Unhandled rejection: ${describe(event.reason)}`);
    },
    { signal },
  );
  signal.addEventListener('abort', () => {
    active = false;
    if (console.error === wrapper) console.error = original;
  });

  return { snapshot: () => [...entries] };
}
