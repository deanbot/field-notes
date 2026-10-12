// The `local` transport: sends a note to the local sink (`field-notes
// serve`, the Vite plugin or the middleware) as multipart form data.
import { type Transport, TransportError } from './transport.ts';

export interface LocalTransportOptions {
  /** The sink's URL, such as `http://localhost:4747/__field-notes`. */
  readonly endpoint: string;
  readonly token: string;
  /**
   * Gives up on a send after this long, as a retryable failure. Kept well
   * under the outbox's send lease (`SEND_LEASE_MS`), so a note is never
   * editable while a send of it may still land.
   */
  readonly timeout?: number | undefined;
  /** Aborts sends in flight (unmount). */
  readonly signal?: AbortSignal | undefined;
}

/** Default time a send may take. */
export const SEND_TIMEOUT_MS = 20_000;

// The sink's codes for a request it will never accept; anything else (a
// wrong token or origin, a server error, no answer) may work later.
const FINAL = ['invalid-request', 'invalid-note', 'too-large'];

export function createLocalTransport(options: LocalTransportOptions): Transport {
  return async (note, attachments) => {
    // The sink assigns the id; ours tells it a resend from a first send.
    const { id, ...fields } = note;
    const form = new FormData();
    form.set('note', JSON.stringify({ ...fields, clientId: id }));
    for (const [name, blob] of Object.entries(attachments)) form.append(name, blob, name);
    const timeout = AbortSignal.timeout(options.timeout ?? SEND_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(options.endpoint, {
        method: 'POST',
        headers: { 'x-field-notes-token': options.token },
        body: form,
        signal: options.signal ? AbortSignal.any([timeout, options.signal]) : timeout,
      });
    } catch (cause) {
      throw new TransportError(`can't reach the sink at ${options.endpoint}`, {
        retryable: true,
        cause,
      });
    }
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (response.ok && typeof body.id === 'string') return body as { id: string };
    const code = typeof body.error === 'string' ? body.error : `HTTP ${String(response.status)}`;
    const message = typeof body.message === 'string' ? `${code}: ${body.message}` : code;
    throw new TransportError(message, { retryable: !FINAL.includes(code) });
  };
}
