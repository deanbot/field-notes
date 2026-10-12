// The local transport against a real sink (run in Node; see test-sink.ts).
import { ulid } from '@field-notes/core/id';
import { NoteSchema } from '@field-notes/core/note';
import { afterEach, describe, expect, it } from 'vitest';
import { DB_NAME, SEND_LEASE_MS, createOutbox } from './outbox.ts';
import { SEND_TIMEOUT_MS, createLocalTransport } from './local-transport.ts';
import { hangingEndpoint, resetSink, sinkNotes, startSink, stopSink } from './test-sink.ts';
import { transportContract } from './transport.contract.ts';
import { TransportError } from './transport.ts';

transportContract('local', async () => {
  await resetSink();
  const { endpoint, token } = await startSink();
  return {
    transport: createLocalTransport({ endpoint, token }),
    stored: sinkNotes,
    cleanup: resetSink,
  };
});

const note = (): ReturnType<typeof NoteSchema.parse> =>
  NoteSchema.parse({
    id: ulid(),
    schema: 1,
    status: 'open',
    created: new Date().toISOString(),
    body: 'local transport',
  });

async function failure(promise: Promise<unknown>): Promise<TransportError> {
  const error: unknown = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(TransportError);
  return error as TransportError;
}

describe('local transport', () => {
  afterEach(resetSink);

  it('sends the id as clientId, and the sink assigns its own', async () => {
    const { endpoint, token } = await startSink();
    const sent = note();
    const receipt = await createLocalTransport({ endpoint, token })(sent, {});
    expect(receipt.id).not.toBe(sent.id);
    const [stored] = await sinkNotes();
    expect(stored?.note.id).toBe(receipt.id);
    expect(stored?.note).not.toHaveProperty('clientId');
  });

  it('fails retryably when the sink is down', async () => {
    const { endpoint, token } = await startSink();
    await stopSink();
    const error = await failure(createLocalTransport({ endpoint, token })(note(), {}));
    expect(error.retryable).toBe(true);
    expect(error.message).toContain("can't reach the sink");
  });

  it('fails retryably on a wrong token, which a new token can fix', async () => {
    const { endpoint } = await startSink();
    const error = await failure(createLocalTransport({ endpoint, token: 'wrong' })(note(), {}));
    expect(error.retryable).toBe(true);
    expect(error.message).toContain('token');
  });

  it('fails retryably on an answer that is not the sink (a wrong endpoint)', async () => {
    const error = await failure(
      createLocalTransport({ endpoint: '/no-sink-here', token: 't' })(note(), {}),
    );
    expect(error.retryable).toBe(true);
    expect(error.message).toContain('HTTP 404');
  });

  it('fails for good on a note the sink will never accept', async () => {
    const { endpoint, token } = await startSink();
    const send = createLocalTransport({ endpoint, token });
    const invalid = await failure(send({ ...note(), status: 'maybe' } as never, {}));
    expect(invalid.retryable).toBe(false);
    expect(invalid.message).toContain('invalid-note');
    const unsent = await failure(send({ ...note(), screenshot: 'shot.png' }, {}));
    expect(unsent.retryable).toBe(false);
  });

  it('gives up on a send that hangs, retryably, well inside the send lease', async () => {
    expect(SEND_TIMEOUT_MS).toBeLessThanOrEqual(SEND_LEASE_MS / 2);
    const endpoint = await hangingEndpoint();
    const started = performance.now();
    const error = await failure(
      createLocalTransport({ endpoint, token: 't', timeout: 200 })(note(), {}),
    );
    expect(error.retryable).toBe(true);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('leaves a hung send in the outbox as a retryable failure, well before the lease ends', async () => {
    // Notes other test files left in the outbox would be sent first.
    await new Promise((done) => {
      indexedDB.deleteDatabase(DB_NAME).onsuccess = done;
    });
    const controller = new AbortController();
    const outbox = createOutbox(controller.signal);
    try {
      const hung = note();
      await outbox.add(hung);
      const transport = createLocalTransport({
        endpoint: await hangingEndpoint(),
        token: 't',
        timeout: 200,
      });
      const started = Date.now();
      expect(await outbox.flush(transport)).toEqual({ delivered: 0, rejected: 0, stopped: true });
      expect(Date.now() - started).toBeLessThan(SEND_LEASE_MS / 10);
      const [entry] = await outbox.list();
      expect(entry).toMatchObject({ state: 'pending', attempts: 1 });
      expect(entry?.rejected).toBeUndefined();
      expect(entry?.sending).toBeUndefined();
    } finally {
      controller.abort();
    }
  });

  it('aborts a send in flight on unmount', async () => {
    const { endpoint, token } = await startSink();
    const controller = new AbortController();
    const sending = createLocalTransport({ endpoint, token, signal: controller.signal })(
      note(),
      {},
    );
    controller.abort();
    expect((await failure(sending)).retryable).toBe(true);
  });
});
