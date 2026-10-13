// Delivery: sends the outbox to the local sink, and keeps trying with
// backoff while the sink is down. A lazy chunk, loaded only when there's
// something to send.
import { createLocalTransport } from './local-transport.ts';
import { createOutbox } from './outbox.ts';
import { type Transport, TransportError } from './transport.ts';

export interface SyncOptions {
  /** The sink's URL; relative URLs resolve against the page. */
  readonly endpoint: string;
  /** Without one, it's fetched from a same-origin sink (see `findToken`). */
  readonly token?: string | undefined;
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

const UNREACHABLE = Symbol('unreachable');

/** Sets delivery up; the first `kick()` sends. */
export function startSync(options: SyncOptions): Sync {
  const { signal } = options;
  const outbox = createOutbox(signal, options.changed);
  const endpoint = new URL(options.endpoint, location.href);
  let transport: Transport | undefined;

  /**
   * A sink on the page's own origin (the Vite plugin, the middleware) hands
   * its token to a same-origin GET. Anything else answering (a dev server
   * without the plugin) means there's no sink: nothing is sent, and the
   * next kick asks again.
   */
  const findToken = async (): Promise<string | typeof UNREACHABLE | undefined> => {
    if (options.token || endpoint.origin !== location.origin) return options.token;
    let res: Response;
    try {
      res = await fetch(endpoint, { cache: 'no-store', signal });
    } catch {
      // The dev server is down (restarting): try again later, as for a send.
      return UNREACHABLE;
    }
    try {
      const body: unknown = res.headers.get('content-type')?.includes('json') && (await res.json());
      const found = (body as { token?: unknown } | undefined)?.token;
      return typeof found === 'string' ? found : undefined;
    } catch {
      return undefined;
    }
  };

  const sender = async (): Promise<Transport | typeof UNREACHABLE | undefined> => {
    if (transport) return transport;
    const found = await findToken();
    if (found === UNREACHABLE) return found;
    if (!found) return undefined;
    const send = createLocalTransport({ endpoint: endpoint.href, token: found, signal });
    transport = async (note, attachments) => {
      try {
        return await send(note, attachments);
      } catch (error) {
        // A fetched token went stale (`.token` was replaced): fetch it again.
        if (!options.token && error instanceof TransportError && error.message.startsWith('token'))
          transport = undefined;
        throw error;
      }
    };
    return transport;
  };

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
        const send = await sender();
        // A kick meanwhile (back online, say) goes round again, not into the backoff.
        if (send === UNREACHABLE) {
          if (sendAgain()) continue;
          if (!signal.aborted) retryLater();
          return;
        }
        if (!send) return;
        if ((await outbox.flush(send)).stopped) {
          if (sendAgain()) continue;
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
  outbox.prune('delivered', DELIVERED_RETENTION_MS).catch(() => undefined);
  return { kick };
}
