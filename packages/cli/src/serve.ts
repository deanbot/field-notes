// `field-notes serve`: the standalone sink, for apps whose dev server can't
// mount the plugin or middleware. Binds to 127.0.0.1 only.
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { DEFAULT_ALLOWED_ORIGINS, createSinkHandler, setUpSinkDir } from '@field-notes/sink';

export interface ServeOptions {
  readonly port: number;
  readonly dir: string;
  readonly version: string;
  /** The script-tag build, with the token placeholder in it. */
  readonly widgetScript: () => Promise<string>;
  /** Origins allowed besides the loopback defaults, such as `http://app.test:3000`. */
  readonly origins?: readonly string[] | undefined;
}

export interface Serving {
  readonly url: string;
  readonly token: string;
  readonly dir: string;
  readonly close: () => Promise<void>;
}

/** Where the built widget leaves the token for `serve` to fill in. */
export const TOKEN_PLACEHOLDER = '{{field-notes-token}}';

const TOKEN = /^[\w-]{20,}$/;

/**
 * The token from `dir/.token`, or a new one written there (owner-only). Kept
 * across restarts: a tab still holding it keeps working.
 */
async function loadToken(dir: string): Promise<string> {
  const file = join(dir, '.token');
  const existing = await readFile(file, 'utf8').then(
    (text) => text.trim(),
    () => '',
  );
  if (TOKEN.test(existing)) return existing;
  const token = randomBytes(32).toString('base64url');
  await writeFile(file, `${token}\n`, { mode: 0o600 });
  return token;
}

export async function serve(options: ServeOptions): Promise<Serving> {
  const dir = resolve(options.dir);
  // `.gitignore` first, so the token is never untracked-but-visible to git.
  await setUpSinkDir(dir);
  const token = await loadToken(dir);
  const sink = createSinkHandler({
    dir,
    token,
    allowedOrigins: [...DEFAULT_ALLOWED_ORIGINS, ...(options.origins ?? [])],
  });

  const server = createServer((req, res) => {
    const path = URL.parse(req.url ?? '/', 'http://serve')?.pathname;
    if (req.method === 'GET' && path === '/widget.js') {
      options.widgetScript().then(
        (script) => {
          res.writeHead(200, {
            'Content-Type': 'text/javascript; charset=utf-8',
            'Cache-Control': 'no-store',
          });
          res.end(script.replace(TOKEN_PLACEHOLDER, token));
        },
        (error: unknown) => {
          console.error('field-notes serve: no widget script.', error);
          res.writeHead(500).end();
        },
      );
      return;
    }
    if (req.method === 'GET' && path === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, version: options.version }));
      return;
    }
    sink(req, res);
  });

  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(options.port, '127.0.0.1', () => {
      server.off('error', fail);
      done();
    });
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    token,
    dir,
    close: () =>
      new Promise((done) => {
        server.close(() => {
          done();
        });
        server.closeAllConnections();
      }),
  };
}
