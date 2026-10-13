import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fieldNotesMiddleware } from './middleware.ts';
import type { SinkHandler } from './handler.ts';

let root: string;
let server: Server | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'field-notes-middleware-'));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await new Promise((done) => {
    if (server) server.close(done);
    else done(undefined);
  });
  server = undefined;
  await rm(root, { recursive: true, force: true });
});

/** A Connect-style app: the middleware, then a fallback that answers "app". */
async function app(middleware: SinkHandler): Promise<string> {
  const running = createServer((req, res) => {
    middleware(req, res, () => {
      res.end('app');
    });
  });
  server = running;
  await new Promise<void>((done) => running.listen(0, '127.0.0.1', done));
  return `http://localhost:${String((running.address() as AddressInfo).port)}`;
}

const token = async (url: string): Promise<Response> =>
  fetch(`${url}/__field-notes`, { headers: { 'sec-fetch-site': 'same-origin' } });

describe('the middleware', () => {
  it('takes notes at /__field-notes and passes other requests on', async () => {
    const url = await app(fieldNotesMiddleware({ dir: join(root, '.field-notes') }));
    expect(await (await fetch(`${url}/page`)).text()).toBe('app');
    const { token: value } = (await (await token(url)).json()) as { token: string };
    const posted = await fetch(`${url}/__field-notes`, {
      method: 'POST',
      headers: { origin: url, 'content-type': 'application/json', 'x-field-notes-token': value },
      body: JSON.stringify({
        schema: 1,
        status: 'open',
        created: '2026-10-09T18:42:11.204Z',
        body: 'x',
      }),
    });
    expect(posted.status).toBe(201);
    expect(await readdir(join(root, '.field-notes', 'items'))).toHaveLength(1);
  });

  it('stands aside in production: no directory, no token, every request passed on', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const url = await app(fieldNotesMiddleware({ dir: join(root, '.field-notes') }));
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.lastCall?.[0]).toContain('force: true');
    expect(await (await token(url)).text()).toBe('app');
    expect(await (await fetch(`${url}/__field-notes`, { method: 'POST' })).text()).toBe('app');
    expect(await readdir(root)).toEqual([]);
  });

  it('mounts in production when forced', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const url = await app(fieldNotesMiddleware({ dir: join(root, '.field-notes'), force: true }));
    expect((await token(url)).status).toBe(200);
  });

  it('defaults to .field-notes in the working directory', () => {
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    fieldNotesMiddleware();
    return expect(readdir(join(root, '.field-notes'))).resolves.toContain('.token');
  });
});
