// Delivery end to end: mount → submit → outbox → local transport → a real
// sink (run in Node; see test-sink.ts) → files on disk.
import { userEvent } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TAG_NAME } from './element.ts';
import { type FieldNotesHandle, type FieldNotesOptions, mountFieldNotes } from './mount.ts';
import { DB_NAME, createOutbox } from './outbox.ts';
import { startScriptTag } from './script-tag.ts';
import { resetSink, sinkNotes, startSink, stopSink } from './test-sink.ts';

let handle: FieldNotesHandle | undefined;
const controllers: AbortController[] = [];

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => {
      resolve();
    };
    request.onerror = () => {
      reject(request.error ?? new Error('delete failed'));
    };
  });
}

beforeEach(async () => {
  localStorage.clear();
  await deleteDatabase();
});

afterEach(async () => {
  handle?.unmount();
  handle = undefined;
  for (const controller of controllers.splice(0)) controller.abort();
  await resetSink();
  localStorage.clear();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const shadow = (): ShadowRoot => {
  const root = document.querySelector(TAG_NAME)?.shadowRoot;
  if (!root) throw new Error('not mounted');
  return root;
};
const query = (selector: string): HTMLElement | null => shadow().querySelector(selector);
const badge = (): string => query('.trigger .badge')?.textContent ?? '';

async function mount(options: FieldNotesOptions = {}): Promise<FieldNotesHandle> {
  const { endpoint, token } = await startSink();
  handle = mountFieldNotes({ enabled: true, endpoint, token, ...options });
  return handle;
}

async function submit(text: string): Promise<void> {
  await handle?.open();
  const textarea = query('#field-notes-text');
  if (!textarea) throw new Error('no textarea');
  await userEvent.type(textarea, text);
  await userEvent.keyboard('{Control>}{Enter}{/Control}');
  await vi.waitFor(() => {
    expect(query('dialog')).toBeNull();
  });
}

const bodies = async (): Promise<string[]> =>
  (await sinkNotes()).map((stored) => stored.note.body).sort();

/** A view of the outbox, as the tests' window into IndexedDB. */
function outbox(): ReturnType<typeof createOutbox> {
  const controller = new AbortController();
  controllers.push(controller);
  return createOutbox(controller.signal);
}

describe('delivery', () => {
  it('sends a submitted note to the sink, and clears the badge', async () => {
    await mount();
    await submit('The total is wrong');
    await vi.waitFor(async () => {
      expect(await bodies()).toEqual(['The total is wrong']);
    });
    await vi.waitFor(() => {
      expect(badge()).toBe('');
    });
    const [entry] = await outbox().list();
    expect(entry).toMatchObject({
      state: 'delivered',
      receipt: { id: expect.any(String) as string },
    });
  });

  it('queues notes while the sink is down, and sends each once when it is back', async () => {
    await mount();
    await stopSink();
    await submit('first');
    await submit('second');
    await vi.waitFor(() => {
      expect(badge()).toBe('2');
    });
    await vi.waitFor(async () => {
      // A flush stops at the first failure, keeping order: only the oldest was tried.
      expect((await outbox().list()).map((e) => e.attempts > 0)).toEqual([true, false]);
    });
    await startSink();
    // The page hears that the network is back, and the backoff fires too.
    dispatchEvent(new Event('online'));
    dispatchEvent(new Event('online'));
    await vi.waitFor(
      async () => {
        expect(await bodies()).toEqual(['first', 'second']);
      },
      { timeout: 5000 },
    );
    await vi.waitFor(() => {
      expect(badge()).toBe('');
    });
    // Nothing is sent twice, whatever else kicks a flush.
    dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((done) => setTimeout(done, 300));
    expect(await bodies()).toEqual(['first', 'second']);
  });

  it('retries with backoff on its own once the sink is back', async () => {
    await mount();
    await stopSink();
    await submit('retried');
    await vi.waitFor(async () => {
      expect((await outbox().list())[0]?.attempts).toBeGreaterThan(0);
    });
    await startSink();
    await vi.waitFor(
      async () => {
        expect(await bodies()).toEqual(['retried']);
      },
      { timeout: 5000 },
    );
  });

  it("keeps the open panel's count current as notes are sent in the background", async () => {
    await mount({ trigger: ['hotkey'] });
    await stopSink();
    await submit('counted');
    await handle?.open();
    const mode = (): string => query('#field-notes-mode')?.textContent.trim() ?? '';
    await vi.waitFor(() => {
      expect(mode()).toBe('My notes (1 not sent)');
    });
    await startSink();
    dispatchEvent(new Event('online'));
    await vi.waitFor(() => {
      expect(mode()).toBe('My notes');
    });
  });

  it('sends notes left from an earlier visit at mount', async () => {
    await outbox().add({
      id: '01J0000000000000000000000A',
      schema: 1,
      status: 'open',
      created: new Date().toISOString(),
      body: 'left over',
    });
    localStorage.setItem('field-notes:pending', '1');
    await mount();
    await vi.waitFor(async () => {
      expect(await bodies()).toEqual(['left over']);
    });
  });

  it('marks a note the sink refuses for good as rejected, and stops sending it', async () => {
    await outbox().add({
      id: '01J0000000000000000000000B',
      schema: 1,
      status: 'open',
      created: new Date().toISOString(),
      // The sink refuses a screenshot that wasn't sent.
      screenshot: 'shot.png',
      body: 'refused',
    });
    localStorage.setItem('field-notes:pending', '1');
    await mount();
    await vi.waitFor(async () => {
      expect((await outbox().list())[0]).toMatchObject({ rejected: true, attempts: 1 });
    });
    await handle?.open();
    await vi.waitFor(() => {
      expect(query('#field-notes-mode')?.textContent).toContain('not sent');
    });
    query('#field-notes-mode')?.click();
    await vi.waitFor(() => {
      expect(query('.entry .meta')?.textContent).toContain('Rejected: invalid-request');
    });
    dispatchEvent(new Event('online'));
    await new Promise((done) => setTimeout(done, 300));
    expect((await outbox().list())[0]?.attempts).toBe(1);
    expect(await sinkNotes()).toEqual([]);
  });

  it('sends nothing without a token: notes wait in the outbox', async () => {
    const { endpoint } = await startSink();
    handle = mountFieldNotes({ enabled: true, endpoint });
    await submit('kept here');
    await new Promise((done) => setTimeout(done, 300));
    expect(await sinkNotes()).toEqual([]);
    expect(badge()).toBe('1');
  });

  it('stops retrying on unmount', async () => {
    await mount();
    await stopSink();
    await submit('abandoned');
    await vi.waitFor(async () => {
      expect((await outbox().list())[0]?.attempts).toBeGreaterThan(0);
    });
    handle?.unmount();
    handle = undefined;
    await startSink();
    await new Promise((done) => setTimeout(done, 2500));
    expect(await sinkNotes()).toEqual([]);
  });
});

describe('a sink on the page origin (the Vite plugin, the middleware)', () => {
  /**
   * Stands in for a sink mounted on the test page's own server: same-origin
   * GETs of /__field-notes get `tokens` in turn, and POSTs go to the real sink.
   */
  async function sameOriginSink(
    tokens: string[],
  ): Promise<{ gets: () => number; posts: () => number }> {
    const { endpoint } = await startSink();
    const real = window.fetch.bind(window);
    let gets = 0;
    let posts = 0;
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.origin !== location.origin || url.pathname !== '/__field-notes')
        return real(input, init);
      if ((init?.method ?? 'GET') === 'GET') {
        const token = tokens[Math.min(gets++, tokens.length - 1)];
        return Promise.resolve(Response.json({ token }));
      }
      posts++;
      return real(endpoint, init);
    });
    return { gets: () => gets, posts: () => posts };
  }

  it('asks it for the token, so the widget needs no options', async () => {
    const sink = await sameOriginSink(['test-sink-token']);
    handle = mountFieldNotes({ enabled: true });
    await submit('handed over');
    await vi.waitFor(async () => {
      expect(await bodies()).toEqual(['handed over']);
    });
    await submit('and again');
    await vi.waitFor(async () => {
      expect(await bodies()).toEqual(['and again', 'handed over']);
    });
    expect(sink.gets()).toBe(1);
  });

  it('asks again after the sink refuses a token, as after .token was replaced', async () => {
    const sink = await sameOriginSink(['stale-token-from-before', 'test-sink-token']);
    handle = mountFieldNotes({ enabled: true });
    await submit('after a new token');
    await vi.waitFor(
      async () => {
        expect(await bodies()).toEqual(['after a new token']);
      },
      { timeout: 5000 },
    );
    expect(sink.gets()).toBe(2);
    expect(sink.posts()).toBe(2);
  });

  it('sends nothing, and counts no failure, when nothing there hands out a token', async () => {
    const real = window.fetch.bind(window);
    const sent: string[] = [];
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      sent.push(init?.method ?? 'GET');
      return real(input, init);
    });
    handle = mountFieldNotes({ enabled: true });
    await submit('no sink here');
    await vi.waitFor(() => {
      expect(sent).toContain('GET');
    });
    await new Promise((done) => setTimeout(done, 300));
    expect(sent).not.toContain('POST');
    const [entry] = await outbox().list();
    expect(entry).toMatchObject({ state: 'pending', attempts: 0 });
  });
});

describe('script tag served by the sink', () => {
  it('sends to the server it came from, with the token it was served with', async () => {
    const { endpoint, token } = await startSink();
    const script = document.createElement('script');
    script.src = new URL('/widget.js', endpoint).href;
    const api = startScriptTag(script, token);
    handle = api.mount();
    await submit('From the script tag');
    await vi.waitFor(async () => {
      expect(await bodies()).toEqual(['From the script tag']);
    });
  });
});
