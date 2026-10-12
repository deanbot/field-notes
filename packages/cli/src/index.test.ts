import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliIo, run } from './index.ts';
import { TOKEN_PLACEHOLDER } from './serve.ts';

interface Captured {
  code: number;
  stdout: string;
  stderr: string;
}

function io(
  overrides: Partial<CliIo> = {},
): CliIo & { out: () => Captured['stdout']; err: () => string } {
  let stdout = '';
  let stderr = '';
  return {
    version: '1.2.3',
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    widgetScript: () => Promise.resolve(`var FieldNotes=(t=>t)("${TOKEN_PLACEHOLDER}");`),
    signal: AbortSignal.abort(),
    out: () => stdout,
    err: () => stderr,
    ...overrides,
  };
}

async function capture(argv: string[]): Promise<Captured> {
  const cli = io();
  const code = await run(argv, cli);
  return { code, stdout: cli.out(), stderr: cli.err() };
}

describe('run', () => {
  it('prints the version', async () => {
    expect(await capture(['--version'])).toEqual({ code: 0, stdout: '1.2.3\n', stderr: '' });
    expect((await capture(['-v'])).stdout).toBe('1.2.3\n');
  });

  it('prints usage with no arguments or --help', async () => {
    for (const argv of [[], ['--help'], ['-h']]) {
      const result = await capture(argv);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Usage: field-notes');
      expect(result.stdout).toContain('serve');
      expect(result.stdout).toContain('--origin');
    }
  });

  it('fails with exit code 2 on unknown commands', async () => {
    const result = await capture(['frobnicate']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Unknown command: frobnicate');
  });

  it('fails with exit code 2 on unknown options', async () => {
    const result = await capture(['--nope']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Usage: field-notes');
  });
});

describe('serve', () => {
  let root: string;
  let stop: AbortController;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'field-notes-serve-'));
    stop = new AbortController();
  });

  afterEach(async () => {
    stop.abort();
    await rm(root, { recursive: true, force: true });
  });

  /** Starts `serve --port 0`, and resolves with its URL once it's listening. */
  async function start(
    args: string[] = [],
    overrides: Partial<CliIo> = {},
  ): Promise<{ url: string; exited: Promise<number>; cli: ReturnType<typeof io> }> {
    const cli = io({ signal: stop.signal, ...overrides });
    const exited = run(['serve', '--port', '0', '--dir', join(root, '.field-notes'), ...args], cli);
    for (let i = 0; i < 200 && !cli.out().includes('http://'); i++) {
      await new Promise((done) => setTimeout(done, 5));
    }
    const url = /http:\/\/127\.0\.0\.1:\d+/.exec(cli.out())?.[0];
    if (!url) throw new Error(`serve didn't start: ${cli.err()}`);
    return { url, exited, cli };
  }

  it('prints its URL and a script tag, and exits 0 when stopped', async () => {
    const { url, exited, cli } = await start();
    const token = (await readFile(join(root, '.field-notes', '.token'), 'utf8')).trim();
    expect(cli.out()).toContain(`token: ${token}`);
    expect(cli.out()).toContain(`<script src="${url}/widget.js"></script>`);
    expect(cli.out()).toContain(
      `mountFieldNotes({ endpoint: '${url}/__field-notes', token: '${token}' })`,
    );
    stop.abort();
    expect(await exited).toBe(0);
  });

  it('serves /health', async () => {
    const { url } = await start();
    const res = await fetch(`${url}/health`);
    expect(await res.json()).toEqual({ ok: true, version: '1.2.3' });
  });

  it('serves /widget.js with the token filled in, uncached', async () => {
    const { url } = await start();
    const token = (await readFile(join(root, '.field-notes', '.token'), 'utf8')).trim();
    const res = await fetch(`${url}/widget.js`);
    expect(res.headers.get('content-type')).toContain('javascript');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const script = await res.text();
    expect(script).toContain(`"${token}"`);
    expect(script).not.toContain(TOKEN_PLACEHOLDER);
  });

  it('answers 500 when there is no widget script', async () => {
    const quiet = console.error;
    console.error = () => undefined;
    try {
      const { url } = await start([], { widgetScript: () => Promise.reject(new Error('no dist')) });
      expect((await fetch(`${url}/widget.js`)).status).toBe(500);
    } finally {
      console.error = quiet;
    }
  });

  it('writes .gitignore before the token, and the token owner-only', async () => {
    await start();
    const dir = join(root, '.field-notes');
    expect(await readFile(join(dir, '.gitignore'), 'utf8')).toBe('*\n');
    expect(await readFile(join(dir, '.token'), 'utf8')).toMatch(/^[\w-]{43}\n$/);
    if (process.platform !== 'win32')
      expect((await stat(join(dir, '.token'))).mode & 0o777).toBe(0o600);
  });

  it('keeps the token across restarts, and replaces one that is not a token', async () => {
    const dir = join(root, '.field-notes');
    await start();
    const first = await readFile(join(dir, '.token'), 'utf8');
    stop.abort();
    stop = new AbortController();
    await start();
    expect(await readFile(join(dir, '.token'), 'utf8')).toBe(first);
    stop.abort();
    stop = new AbortController();
    await writeFile(join(dir, '.token'), 'short\n');
    await start();
    expect(await readFile(join(dir, '.token'), 'utf8')).not.toBe('short\n');
  });

  it('stores notes sent with the token, and refuses them without', async () => {
    const { url } = await start();
    const token = (await readFile(join(root, '.field-notes', '.token'), 'utf8')).trim();
    const note = {
      schema: 1,
      status: 'open',
      created: '2026-10-09T18:42:11.204Z',
      body: 'From serve',
    };
    const send = (headers: Record<string, string>): Promise<Response> =>
      fetch(`${url}/__field-notes`, {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          'content-type': 'application/json',
          ...headers,
        },
        body: JSON.stringify(note),
      });
    expect((await send({})).status).toBe(401);
    expect((await send({ 'x-field-notes-token': token })).status).toBe(201);
    expect(await readdir(join(root, '.field-notes', 'items'))).toHaveLength(1);
  });

  it('takes notes from an https dev page, and from an origin given with --origin', async () => {
    const { url } = await start([
      '--origin',
      'http://app.test:3000',
      '--origin',
      'http://other.test:*',
    ]);
    const token = (await readFile(join(root, '.field-notes', '.token'), 'utf8')).trim();
    const send = (origin: string): Promise<number> =>
      fetch(`${url}/__field-notes`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json', 'x-field-notes-token': token },
        body: JSON.stringify({
          schema: 1,
          status: 'open',
          created: '2026-10-09T18:42:11.204Z',
          body: origin,
        }),
      }).then((res) => res.status);
    expect(await send('https://localhost:5173')).toBe(201);
    expect(await send('http://app.test:3000')).toBe(201);
    expect(await send('http://other.test:8080')).toBe(201);
    expect(await send('http://app.test:3001')).toBe(403);
    expect(await send('http://evil.test')).toBe(403);
  });

  it('rejects an --origin that is not an origin', async () => {
    for (const origin of ['app.test', 'http://app.test/path', '*']) {
      const result = await capture(['serve', '--origin', origin]);
      expect(result.code).toBe(2);
      expect(result.stderr).toContain('--origin');
    }
  });

  it('exits 1 with a clear message when the port is taken', async () => {
    const blocker = createServer();
    await new Promise<void>((done) => blocker.listen(0, '127.0.0.1', done));
    const port = (blocker.address() as { port: number }).port;
    try {
      const cli = io({ signal: stop.signal });
      const code = await run(['serve', '--port', String(port), '--dir', join(root, 'x')], cli);
      expect(code).toBe(1);
      expect(cli.err()).toContain(`Port ${String(port)} is in use`);
    } finally {
      await new Promise((done) => blocker.close(done));
    }
  });

  it('exits 1 when the directory cannot be set up', async () => {
    await writeFile(join(root, 'file'), '');
    const cli = io({ signal: stop.signal });
    expect(await run(['serve', '--port', '0', '--dir', join(root, 'file')], cli)).toBe(1);
    expect(cli.err()).toContain("Couldn't start the sink");
  });

  it('rejects a bad port', async () => {
    for (const port of ['x', '-1', '65536', '1.5']) {
      const result = await capture(['serve', '--port', port]);
      expect(result.code).toBe(2);
      expect(result.stderr).toContain('--port');
    }
  });
});
