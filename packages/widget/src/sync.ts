// Delivery: sends the outbox to the local sink, and keeps trying with
// backoff while the sink is down. A lazy chunk, loaded only when the widget
// has a token and there's something to send.
import { createLocalTransport } from './local-transport.ts';
import { createOutbox } from './outbox.ts';

export interface SyncOptions {
  /** The sink's URL; relative URLs resolve against the page. */
  readonly endpoint: string;
  readonly token: string;
  /** Hears the pending count after each change, for the badge. */
  readonly changed: (pending: number) => void;
  /** Unmount: stops retrying and aborts a send in flight. */
  readonly signal: AbortSignal;
}

export interface Sync {
  /** Sends now: a note was added, or the page thinks the sink may be back. */
  readonly kick: () => void;
}

/** First retry after a failed send; doubles each time, up to the max. */
export const RETRY_MIN_MS = 1000;
export const RETRY_MAX_MS = 60_000;
/** How long delivered notes stay listed in "My notes". */
export const DELIVERED_RETENTION_MS: number = 7 * 24 * 60 * 60 * 1000;

/** Sets delivery up; the first `kick()` sends. */
export function startSync(options: SyncOptions): Sync {
  const { signal } = options;
  const outbox = createOutbox(signal, options.changed);
  const transport = createLocalTransport({
    endpoint: new URL(options.endpoint, location.href).href,
    token: options.token,
    signal,
  });
  let running = false;
  let again = false;
  let delay = RETRY_MIN_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const retryLater = (): void => {
    timer = setTimeout(kick, delay);
    delay = Math.min(delay * 2, RETRY_MAX_MS);
  };

  // A kick during a flush: notes may have arrived after it read the outbox.
  const sendAgain = (): boolean => again && !signal.aborted;

  const run = async (): Promise<void> => {
    running = true;
    try {
      do {
        again = false;
        if ((await outbox.flush(transport)).stopped) {
          retryLater();
          return;
        }
        delay = RETRY_MIN_MS;
      } while (sendAgain());
    } catch (error) {
      // The outbox itself failed (IndexedDB unavailable): try again later.
      if (!signal.aborted) {
        console.warn('[field-notes] could not send notes.', error);
        retryLater();
      }
    } finally {
      running = false;
    }
  };

  const kick = (): void => {
    if (signal.aborted) return;
    if (running) {
      again = true;
      return;
    }
    clearTimeout(timer);
    void run();
  };

  signal.addEventListener('abort', () => {
    clearTimeout(timer);
  });
  addEventListener('online', kick, { signal });
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.visibilityState === 'visible') kick();
    },
    { signal },
  );
  outbox.prune(DELIVERED_RETENTION_MS).catch(() => undefined);
  return { kick };
}
