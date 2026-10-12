// The plugin on a real Vite dev server, and absent from production builds.
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Plugin, type ViteDevServer, build, createServer, resolveConfig } from 'vite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fieldNotes } from './vite.ts';

let root: string;
let server: ViteDevServer | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'field-notes-vite-'));
  await writeFile(join(root, 'index.html'), '<!doctype html><title>app</title><p>app</p>');
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  await rm(root, { recursive: true, force: true });
});

async function dev(options: Parameters<typeof fieldNotes>[0] = {}): Promise<string> {
  server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [fieldNotes(options)],
    server: { port: 0, host: '127.0.0.1' },
  });
  await server.listen();
  const address = server.httpServer?.address() as AddressInfo;
  return `http://localhost:${String(address.port)}`;
}

const note = { schema: 1, status: 'open', created: '2026-10-09T18:42:11.204Z', body: 'From Vite' };

describe('the Vite plugin', () => {
  it("is a Vite Plugin (its own structural type can't drift from Vite's)", () => {
    const plugin: Plugin = fieldNotes();
    expect(plugin).toMatchObject({ name: 'field-notes', apply: 'serve' });
  });

  it('takes notes at /__field-notes, with the token it hands to same-origin pages', async () => {
    const url = await dev();
    const res = await fetch(`${url}/__field-notes`, {
      headers: { 'sec-fetch-site': 'same-origin' },
    });
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { token } = (await res.json()) as { token: string };
    expect(token).toBe((await readFile(join(root, '.field-notes', '.token'), 'utf8')).trim());
    const posted = await fetch(`${url}/__field-notes`, {
      method: 'POST',
      headers: { origin: url, 'content-type': 'application/json', 'x-field-notes-token': token },
      body: JSON.stringify(note),
    });
    expect(posted.status).toBe(201);
    expect(await readdir(join(root, '.field-notes', 'items'))).toHaveLength(1);
    expect(await readFile(join(root, '.field-notes', '.gitignore'), 'utf8')).toBe('*\n');
    // Vite still serves the app.
    expect(await (await fetch(`${url}/`)).text()).toContain('<p>app</p>');
  });

  it('keeps the token from other sites', async () => {
    const url = await dev();
    for (const site of ['cross-site', 'same-site', 'none']) {
      const res = await fetch(`${url}/__field-notes`, { headers: { 'sec-fetch-site': site } });
      expect(res.status, site).toBe(403);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    }
    expect((await fetch(`${url}/__field-notes`)).status).toBe(403);
  });

  it('writes notes to a configured directory, and allows configured origins', async () => {
    const url = await dev({ dir: 'notes', origins: ['http://app.test:5173'] });
    const { token } = (await (
      await fetch(`${url}/__field-notes`, { headers: { 'sec-fetch-site': 'same-origin' } })
    ).json()) as { token: string };
    const posted = await fetch(`${url}/__field-notes`, {
      method: 'POST',
      headers: {
        origin: 'http://app.test:5173',
        'content-type': 'application/json',
        'x-field-notes-token': token,
      },
      body: JSON.stringify(note),
    });
    expect(posted.status).toBe(201);
    expect(await readdir(join(root, 'notes', 'items'))).toHaveLength(1);
  });
});

describe('production builds', () => {
  it('leave the plugin out', async () => {
    const config = await resolveConfig(
      { root, configFile: false, logLevel: 'silent', plugins: [fieldNotes()] },
      'build',
    );
    expect(config.plugins.map((plugin) => plugin.name)).not.toContain('field-notes');
  });

  it('create no .field-notes directory', async () => {
    await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [fieldNotes()],
      build: { outDir: join(root, 'dist') },
    });
    expect(existsSync(join(root, 'dist', 'index.html'))).toBe(true);
    expect(existsSync(join(root, '.field-notes'))).toBe(false);
  });
});
