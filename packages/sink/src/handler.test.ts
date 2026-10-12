// The handler over real HTTP, writing into a temp directory.
import * as fs from 'node:fs/promises';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { type Server, createServer, request } from 'node:http';
import { type AddressInfo, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as core from '@field-notes/core';
import { parseNote } from '@field-notes/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type SinkOptions, TOKEN_HEADER, createSinkHandler } from './handler.ts';

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof fs>();
  return { ...actual, rename: vi.fn(actual.rename), link: vi.fn(actual.link) };
});
vi.mock('@field-notes/core', async (original) => {
  const actual = await original<typeof core>();
  return { ...actual, ulid: vi.fn(actual.ulid) };
});

const TOKEN = 'test-token';
const ORIGIN = 'http://localhost:5173';

let root: string;
let dir: string;
let server: Server | undefined;
let base: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'field-notes-sink-'));
  dir = join(root, '.field-notes');
});

afterEach(async () => {
  await stop(server);
  server = undefined;
  await rm(root, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.mocked(core.ulid).mockReset();
  vi.mocked(fs.rename).mockReset();
  vi.mocked(fs.link).mockReset();
});

function stop(running: Server | undefined): Promise<void> {
  return new Promise((done) => {
    if (running)
      running.close(() => {
        done();
      });
    else done();
  });
}

async function start(options: Partial<SinkOptions> = {}): Promise<void> {
  const handler = createSinkHandler({ dir, token: TOKEN, defaultAuthor: false, ...options });
  const running = createServer((req, res) => {
    handler(req, res);
  });
  server = running;
  await new Promise<void>((done) => running.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${String((running.address() as AddressInfo).port)}`;
}

function payload(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 1,
    status: 'open',
    created: '2026-10-09T18:42:11.204Z',
    type: 'bug',
    url: 'http://localhost:5173/checkout',
    body: 'The total is wrong',
    ...fields,
  };
}

interface Sent {
  status: number;
  json: Record<string, unknown>;
  headers: Headers;
}

async function post(
  body: string | FormData | Record<string, unknown>,
  headers: Record<string, string> = {},
  path = '/__field-notes',
): Promise<Sent> {
  const isJson = !(body instanceof FormData) && typeof body === 'object';
  const res = await fetch(base + path, {
    method: 'POST',
    headers: {
      origin: ORIGIN,
      [TOKEN_HEADER]: TOKEN,
      ...(isJson ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: isJson ? JSON.stringify(body) : body,
  });
  return {
    status: res.status,
    json: (await res.json()) as Record<string, unknown>,
    headers: res.headers,
  };
}

function form(fields: Record<string, unknown>, files: Record<string, Blob> = {}): FormData {
  const data = new FormData();
  data.set('note', JSON.stringify(fields));
  for (const [name, blob] of Object.entries(files)) data.append(name, blob, 'ignored.bin');
  return data;
}

const items = (): Promise<string[]> =>
  readdir(join(dir, 'items')).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  });

async function readNote(receiptDir: unknown): Promise<core.Note> {
  const parsed = parseNote(await readFile(join(dir, String(receiptDir), 'note.md'), 'utf8'));
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
}

describe('storing a note', () => {
  it('writes note.md under a server id and slug, and answers 201 with a receipt', async () => {
    await start();
    const { status, json } = await post(payload());
    expect(status).toBe(201);
    expect(json.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(json.dir).toBe(`items/${String(json.id)}-the-total-is-wrong`);
    expect(await items()).toEqual([`${String(json.id)}-the-total-is-wrong`]);
    // Written files validate against the schema, and hold what was sent.
    expect(await readNote(json.dir)).toEqual({ ...payload(), id: json.id });
  });

  it('stores attachments from a multipart body under their field names', async () => {
    await start();
    const png = new Uint8Array([137, 80, 78, 71]);
    const { status, json } = await post(
      form(payload({ screenshot: 'screenshot.png' }), {
        'screenshot.png': new Blob([png], { type: 'image/png' }),
        'log.txt': new Blob(['console output']),
      }),
    );
    expect(status).toBe(201);
    const files = await readdir(join(dir, String(json.dir)));
    expect(files.sort()).toEqual(['log.txt', 'note.md', 'screenshot.png']);
    expect(new Uint8Array(await readFile(join(dir, String(json.dir), 'screenshot.png')))).toEqual(
      png,
    );
    expect((await readNote(json.dir)).screenshot).toBe('screenshot.png');
  });

  it("creates .gitignore once, and leaves one that's there alone", async () => {
    await start();
    await post(payload());
    expect(await readFile(join(dir, '.gitignore'), 'utf8')).toBe('*\n');
    await writeFile(join(dir, '.gitignore'), '# mine\n');
    await post(payload());
    expect(await readFile(join(dir, '.gitignore'), 'utf8')).toBe('# mine\n');
  });

  it('writes the configured .gitignore, or none', async () => {
    await start({ gitignore: 'items/\n' });
    await post(payload());
    expect(await readFile(join(dir, '.gitignore'), 'utf8')).toBe('items/\n');
    await stop(server);
    await rm(dir, { recursive: true });
    await start({ gitignore: false });
    await post(payload());
    expect(await readdir(dir)).not.toContain('.gitignore');
  });

  it('fills in a default author, but keeps one that was sent', async () => {
    await start({ defaultAuthor: 'Sam' });
    expect((await readNote((await post(payload())).json.dir)).author).toBe('Sam');
    expect((await readNote((await post(payload({ author: 'Ari' }))).json.dir)).author).toBe('Ari');
  });

  it('defaults the author to git config user.name above the directory', async () => {
    const { execFileSync } = await import('node:child_process');
    execFileSync('git', ['init', '-q', root]);
    execFileSync('git', ['-C', root, 'config', 'user.name', 'Git Person']);
    await start({ defaultAuthor: undefined });
    expect((await readNote((await post(payload())).json.dir)).author).toBe('Git Person');
  });

  it('leaves the author out when git has none', async () => {
    await start({ defaultAuthor: undefined, dir: join(root, 'missing', '.field-notes') });
    dir = join(root, 'missing', '.field-notes');
    const { json } = await post(payload());
    // The directory above didn't exist when git ran, so there's no name.
    expect(await readNote(json.dir)).not.toHaveProperty('author');
  });

  it('gives the note a new id when its directory is taken', async () => {
    await start();
    const ulid = vi.mocked(core.ulid);
    ulid
      .mockReturnValueOnce('01J0000000000000000000000A')
      .mockReturnValueOnce('01J0000000000000000000000A');
    const first = await post(payload());
    const second = await post(payload());
    expect(first.json.id).toBe('01J0000000000000000000000A');
    expect(second.status).toBe(201);
    expect(second.json.id).not.toBe(first.json.id);
    expect(await items()).toHaveLength(2);
  });

  it('gives up after too many clashes, and leaves nothing behind', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await start();
    await mkdir(join(dir, 'items', '01J0000000000000000000000A-the-total-is-wrong'), {
      recursive: true,
    });
    vi.mocked(core.ulid).mockReturnValue('01J0000000000000000000000A');
    const { status, json } = await post(payload());
    expect(status).toBe(500);
    expect(json.error).toBe('internal');
    expect(await items()).toHaveLength(1);
  });

  it('removes a half-written note when a write fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await start();
    const rename = vi.mocked(fs.rename);
    // The first attachment lands; the second fails.
    rename.mockImplementationOnce(rename.getMockImplementation() ?? fs.rename);
    rename.mockRejectedValueOnce(Object.assign(new Error('disk full'), { code: 'ENOSPC' }));
    const { status } = await post(
      form(payload(), { 'a.txt': new Blob(['a']), 'b.txt': new Blob(['b']) }),
    );
    expect(status).toBe(500);
    expect(await items()).toEqual([]);
  });

  it('answers 500 while the directory is unusable, and recovers once it is', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await start();
    await writeFile(dir, 'a file where the directory should be');
    expect((await post(payload())).status).toBe(500);
    await rm(dir);
    expect((await post(payload())).status).toBe(201);
    await fs.chmod(join(dir, 'items'), 0o500);
    try {
      expect((await post(payload())).status).toBe(500);
    } finally {
      await fs.chmod(join(dir, 'items'), 0o700);
    }
  });

  it('sets the directory up again when it is deleted while the sink runs', async () => {
    await start();
    expect((await post(payload())).status).toBe(201);
    await rm(dir, { recursive: true });
    expect((await post(payload())).status).toBe(201);
    expect(await items()).toHaveLength(1);
    expect(await readFile(join(dir, '.gitignore'), 'utf8')).toBe('*\n');
  });

  it('stores every one of many concurrent notes intact', async () => {
    await start();
    const sent = Array.from({ length: 40 }, (_, i) =>
      post(
        form(payload({ body: `Same first line\n\nnote ${String(i)}` }), {
          'n.txt': new Blob([String(i)]),
        }),
      ),
    );
    const results = await Promise.all(sent);
    expect(results.map((r) => r.status)).toEqual(results.map(() => 201));
    const bodies = await Promise.all(
      results.map(async ({ json }) => {
        const note = await readNote(json.dir);
        const file = await readFile(join(dir, String(json.dir), 'n.txt'), 'utf8');
        expect(note.body.endsWith(`note ${file}`)).toBe(true);
        return note.body;
      }),
    );
    expect(new Set(bodies).size).toBe(40);
    expect(await items()).toHaveLength(40);
  });
});

describe('idempotency', () => {
  it('answers a resend with the same clientId with the first receipt, and stores once', async () => {
    await start();
    const first = await post(payload({ clientId: '01JCLIENT0000000000000000A' }));
    const again = await post(payload({ clientId: '01JCLIENT0000000000000000A' }));
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.json).toEqual(first.json);
    expect(await items()).toHaveLength(1);
    // clientId isn't part of the note.
    expect(await readNote(first.json.dir)).not.toHaveProperty('clientId');
  });

  it('stores concurrent sends with the same clientId once', async () => {
    await start();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => post(payload({ clientId: 'same' }))),
    );
    expect(new Set(results.map((r) => r.json.id)).size).toBe(1);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await items()).toHaveLength(1);
  });

  it('remembers a clientId across a restart', async () => {
    await start();
    const first = await post(payload({ clientId: 'kept' }));
    await stop(server);
    await start();
    const again = await post(payload({ clientId: 'kept' }));
    expect(again.status).toBe(200);
    expect(again.json).toEqual(first.json);
    expect(await items()).toHaveLength(1);
  });

  it('keeps the first note when another process stored the same clientId meanwhile', async () => {
    await start();
    const other = createSinkHandler({ dir, token: TOKEN, defaultAuthor: false });
    const otherServer = createServer((req, res) => {
      other(req, res);
    });
    await new Promise<void>((done) => otherServer.listen(0, '127.0.0.1', done));
    const otherBase = `http://127.0.0.1:${String((otherServer.address() as AddressInfo).port)}`;
    try {
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) => {
          const url = (i % 2 ? otherBase : base) + '/__field-notes';
          return fetch(url, {
            method: 'POST',
            headers: { origin: ORIGIN, [TOKEN_HEADER]: TOKEN, 'content-type': 'application/json' },
            body: JSON.stringify(payload({ clientId: 'raced' })),
          }).then((r) => r.json() as Promise<Record<string, unknown>>);
        }),
      );
      expect(new Set(results.map((r) => r.id)).size).toBe(1);
      expect(await items()).toHaveLength(1);
    } finally {
      await new Promise((done) => otherServer.close(done));
    }
  });

  it('lets a retry store the note after a failed first try', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await start();
    vi.mocked(core.ulid).mockImplementationOnce(() => {
      throw new Error('disk on fire');
    });
    expect((await post(payload({ clientId: 'retry' }))).status).toBe(500);
    const retry = await post(payload({ clientId: 'retry' }));
    expect(retry.status).toBe(201);
    expect(await items()).toHaveLength(1);
  });

  it('answers 500 when a clientId record is unreadable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await start();
    await post(payload({ clientId: 'first' }));
    const [record] = await readdir(join(dir, '.sink', 'keys'));
    await rm(join(dir, '.sink', 'keys', String(record)));
    await mkdir(join(dir, '.sink', 'keys', String(record)));
    expect((await post(payload({ clientId: 'first' }))).status).toBe(500);
  });

  it('stores nothing when the clientId record fails, so a retry stores the note once', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await start();
    // A filesystem without hard links.
    vi.mocked(fs.link).mockRejectedValueOnce(
      Object.assign(new Error('no links'), { code: 'EPERM' }),
    );
    expect((await post(payload({ clientId: 'unrecorded' }))).status).toBe(500);
    expect(await items()).toEqual([]);
    expect(await readdir(join(dir, '.sink', 'keys'))).toEqual([]);
    expect((await post(payload({ clientId: 'unrecorded' }))).status).toBe(201);
    expect(await items()).toHaveLength(1);
  });

  it('never uses the clientId as a path', async () => {
    await start();
    const { status } = await post(payload({ clientId: '../../escaped' }));
    expect(status).toBe(201);
    expect(
      (await readdir(join(dir, '.sink', 'keys'))).every((f) => /^[0-9a-f]{64}\.json$/.test(f)),
    ).toBe(true);
    expect(await readdir(root)).toEqual(['.field-notes']);
  });

  it('rejects a clientId that is not a non-empty string', async () => {
    await start();
    expect((await post(payload({ clientId: 7 }))).json.error).toBe('invalid-request');
    expect((await post(payload({ clientId: '' }))).json.error).toBe('invalid-request');
  });
});

describe('refusing requests', () => {
  it('rejects a disallowed, missing or null origin, without CORS headers', async () => {
    await start();
    for (const origin of ['http://evil.example', 'null']) {
      const res = await post(payload(), { origin });
      expect(res.status).toBe(403);
      expect(res.json.error).toBe('origin');
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    }
    // fetch always sends an Origin it's given; node:http can leave it out.
    expect(await rawStatus({ [TOKEN_HEADER]: TOKEN, 'content-type': 'application/json' })).toBe(
      403,
    );
    expect(await items()).toEqual([]);
  });

  it('accepts a configured origin', async () => {
    await start({ allowedOrigins: ['https://app.test:8443'] });
    expect((await post(payload(), { origin: 'https://app.test:8443' })).status).toBe(201);
    expect((await post(payload())).status).toBe(403);
  });

  it('rejects a missing or wrong token', async () => {
    await start();
    for (const token of ['', 'wrong', `${TOKEN}x`]) {
      const res = await post(payload(), { [TOKEN_HEADER]: token });
      expect(res.status).toBe(401);
      expect(res.json.error).toBe('token');
      // An allowed origin can read why.
      expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    }
    expect(await items()).toEqual([]);
  });

  it('answers a preflight from an allowed origin without a token', async () => {
    await start();
    const res = await fetch(`${base}/__field-notes`, {
      method: 'OPTIONS',
      headers: {
        origin: ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': `content-type, ${TOKEN_HEADER}`,
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(res.headers.get('access-control-allow-headers')).toContain(TOKEN_HEADER);
    expect(res.headers.get('vary')).toBe('Origin');
    const evil = await fetch(`${base}/__field-notes`, {
      method: 'OPTIONS',
      headers: { origin: 'http://evil.example' },
    });
    expect(evil.status).toBe(403);
  });

  it('rejects other methods and content types', async () => {
    await start();
    const get = await fetch(`${base}/__field-notes`, { headers: { origin: ORIGIN } });
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST, OPTIONS');
    const text = await post('hello', { 'content-type': 'text/plain' });
    expect(text.status).toBe(415);
  });

  it('hands the token only to a same-origin GET, and only when asked to', async () => {
    await start({ tokenToSameOrigin: true });
    const get = (headers: Record<string, string>): Promise<Response> =>
      fetch(`${base}/__field-notes`, { headers });
    const same = await get({ 'sec-fetch-site': 'same-origin' });
    expect(same.status).toBe(200);
    expect(await same.json()).toEqual({ token: TOKEN });
    expect(same.headers.get('cache-control')).toBe('no-store');
    for (const headers of [{ 'sec-fetch-site': 'cross-site' }, {}, { origin: ORIGIN }]) {
      const res = await get(headers);
      expect(res.status).toBe(403);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    }
    // POSTs still need the token.
    expect((await post(payload(), { [TOKEN_HEADER]: '' })).status).toBe(401);
    await stop(server);
    await start();
    expect((await get({ 'sec-fetch-site': 'same-origin' })).status).toBe(403);
  });

  it('keeps the token from clients on other machines, whatever headers they send', async () => {
    const handler = createSinkHandler({
      dir,
      token: TOKEN,
      defaultAuthor: false,
      tokenToSameOrigin: true,
    });
    let peer = '192.168.1.20';
    const running = createServer((req, res) => {
      // As if the request came over the network (`vite --host`).
      Object.defineProperty(req.socket, 'remoteAddress', { value: peer, configurable: true });
      handler(req, res);
    });
    server = running;
    await new Promise<void>((done) => running.listen(0, '127.0.0.1', done));
    base = `http://127.0.0.1:${String((running.address() as AddressInfo).port)}`;
    const get = (): Promise<Response> =>
      fetch(`${base}/__field-notes`, { headers: { 'sec-fetch-site': 'same-origin' } });
    for (const address of ['192.168.1.20', '10.0.0.5', 'fe80::1', '::ffff:192.168.1.20']) {
      peer = address;
      const res = await get();
      expect(res.status, address).toBe(403);
      expect(await res.text()).not.toContain(TOKEN);
    }
    for (const address of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1']) {
      peer = address;
      expect((await get()).status, address).toBe(200);
    }
  });

  it('passes other paths to next, or answers 404', async () => {
    const handler = createSinkHandler({ dir, token: TOKEN, defaultAuthor: false });
    const next = vi.fn();
    server = createServer((req, res) => {
      if (req.url === '/with-next') {
        handler(req, res, () => {
          next();
          res.end('next');
        });
      } else handler(req, res);
    });
    await new Promise<void>((done) => server?.listen(0, '127.0.0.1', done));
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
    expect(await (await fetch(`${base}/with-next`)).text()).toBe('next');
    expect(next).toHaveBeenCalledOnce();
    expect((await fetch(`${base}/elsewhere`)).status).toBe(404);
  });

  it('survives a malformed request URL', async () => {
    await start();
    const port = new URL(base).port;
    const answer = await new Promise<string>((done, fail) => {
      const socket = connect(Number(port), '127.0.0.1', () => {
        socket.end('GET http://[ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
      });
      let text = '';
      socket.on('data', (chunk: Buffer) => (text += chunk.toString()));
      socket.on('end', () => {
        done(text);
      });
      socket.on('error', fail);
    });
    expect(answer).toMatch(/^HTTP\/1\.1 404/);
    // Still serving.
    expect((await post(payload())).status).toBe(201);
  });

  it('takes notes at a configured path, with a query string', async () => {
    await start({ path: '/notes' });
    expect((await post(payload(), {}, '/notes?v=1')).status).toBe(201);
    expect((await post(payload(), {}, '/__field-notes')).status).toBe(404);
  });

  it('rejects a body over the limit by Content-Length, before reading it', async () => {
    await start({ maxBytes: 1024 });
    const res = await post(payload({ body: 'x'.repeat(2000) }));
    expect(res.status).toBe(413);
    expect(res.json.error).toBe('too-large');
    expect(await items()).toEqual([]);
  });

  it('stops reading a chunked body once it passes the limit', async () => {
    await start({ maxBytes: 64 * 1024 });
    let pushed = 0;
    // No Content-Length: the size is only known by reading.
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pushed += 16 * 1024;
        if (pushed > 10 * 1024 * 1024) controller.close();
        else controller.enqueue(new Uint8Array(16 * 1024).fill(32));
      },
    });
    const closed: Record<string, unknown> = {};
    const outcome = await fetch(`${base}/__field-notes`, {
      method: 'POST',
      headers: { origin: ORIGIN, [TOKEN_HEADER]: TOKEN, 'content-type': 'application/json' },
      body: stream,
      duplex: 'half',
    }).then(
      async (res) => ({ status: res.status, json: (await res.json()) as Record<string, unknown> }),
      () => ({ status: 0, json: closed }),
    );
    // Either the 413 arrives, or the connection closes mid-upload; never a read to the end.
    if (outcome.status) expect(outcome.json.error).toBe('too-large');
    expect(pushed).toBeLessThan(10 * 1024 * 1024);
    expect(await items()).toEqual([]);
  });

  it.each([
    ['not JSON', '{', 'invalid-request'],
    ['a JSON array', '[]', 'invalid-request'],
    ['JSON null', 'null', 'invalid-request'],
  ])('rejects a body that is %s', async (_, body, error) => {
    await start();
    const res = await post(body, { 'content-type': 'application/json' });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe(error);
  });

  it('rejects an invalid note with 422, and writes nothing', async () => {
    await start();
    for (const bad of [
      payload({ status: 'maybe' }),
      payload({ body: undefined }),
      payload({ schema: 2 }),
    ]) {
      const res = await post(bad);
      expect(res.status).toBe(422);
      expect(res.json.error).toBe('invalid-note');
    }
    expect(await items()).toEqual([]);
  });

  it('rejects a client-supplied id rather than use it', async () => {
    await start();
    const res = await post(payload({ id: '../../escaped' }));
    expect(res.status).toBe(400);
    expect(res.json.message).toContain('clientId');
    expect(await readdir(root)).toEqual([]);
  });

  it('derives the directory from the body, never from a path in it', async () => {
    await start();
    const { json } = await post(payload({ body: '../../../etc/passwd\nmore' }));
    expect(json.dir).toBe(`items/${String(json.id)}-etc-passwd`);
    expect(await readdir(root)).toEqual(['.field-notes']);
  });

  it.each(['../evil.png', '..', 'a/b.png', 'a\\b.png', 'C:evil.png', '.hidden', ''])(
    'rejects the attachment name %j',
    async (name) => {
      await start();
      const res = await post(form(payload(), { [name]: new Blob(['x']) }));
      expect(res.status).toBe(400);
      expect(res.json.error).toBe('invalid-request');
      expect(await items()).toEqual([]);
    },
  );

  it.each([
    ['note.md', 'note.md'],
    ['NOTE.MD', 'NOTE.MD'],
    ['a.png', 'A.png'],
  ])('rejects attachment names that clash: %s and %s', async (first, second) => {
    await start();
    const data = form(payload(), { [first]: new Blob(['1']) });
    if (second !== first) data.append(second, new Blob(['2']));
    const res = await post(data);
    expect(res.status).toBe(400);
    expect(res.json.message).toContain('taken');
    expect(await items()).toEqual([]);
  });

  it('ignores the multipart filename, even a path', async () => {
    await start();
    const data = new FormData();
    data.set('note', JSON.stringify(payload()));
    data.append('shot.png', new Blob(['x']), '../../outside.png');
    const { json } = await post(data);
    expect((await readdir(join(dir, String(json.dir)))).sort()).toEqual(['note.md', 'shot.png']);
    expect(await readdir(root)).toEqual(['.field-notes']);
  });

  it('rejects a screenshot path, or one that was not sent', async () => {
    await start();
    expect((await post(payload({ screenshot: '../x.png' }))).status).toBe(400);
    const notSent = await post(form(payload({ screenshot: 'shot.png' })));
    expect(notSent.status).toBe(400);
    expect(notSent.json.message).toContain('screenshot');
  });

  it('rejects malformed multipart bodies', async () => {
    await start();
    const twoNotes = new FormData();
    twoNotes.append('note', JSON.stringify(payload()));
    twoNotes.append('note', JSON.stringify(payload()));
    const noteAsFile = new FormData();
    noteAsFile.set('note', new Blob([JSON.stringify(payload())]));
    const textAttachment = form(payload());
    textAttachment.set('log.txt', 'not a file');
    const duplicate = form(payload());
    duplicate.append('a.txt', new Blob(['1']));
    duplicate.append('a.txt', new Blob(['2']));
    for (const body of [new FormData(), twoNotes, noteAsFile, textAttachment, duplicate]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(res.json.error).toBe('invalid-request');
    }
    const garbled = await post('--nope\r\n\r\n', {
      'content-type': 'multipart/form-data; boundary=x',
    });
    expect(garbled.status).toBe(400);
    expect(await items()).toEqual([]);
  });
});

/** A POST through node:http, which can leave out the Origin header. */
function rawStatus(headers: Record<string, string>): Promise<number> {
  return new Promise((done, fail) => {
    const req = request(`${base}/__field-notes`, { method: 'POST', headers }, (res) => {
      res.resume();
      done(res.statusCode ?? 0);
    });
    req.on('error', fail);
    req.end(JSON.stringify(payload()));
  });
}
