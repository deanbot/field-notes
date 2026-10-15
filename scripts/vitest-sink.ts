// Vitest browser commands: a real sink for widget tests. Commands run in
// Node; browser tests call them through `commands` from 'vitest/browser'
// (typed in packages/widget/src/test-sink.ts). Each browser engine gets its
// own sink: engines run their test files at the same time.
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserCommandContext } from 'vitest/node';
import { parseNote } from '../packages/core/src/index.ts';
import { createSinkHandler } from '../packages/sink/src/index.ts';

const TOKEN = 'test-sink-token';

interface Sink {
  server?: Server | undefined;
  dir?: string | undefined;
  port: number;
  hanging?: Server | undefined;
}

const sinks = new Map<string, Sink>();

/** The calling engine's sink. */
function sinkFor(context: BrowserCommandContext): Sink {
  const key = context.project.name;
  let sink = sinks.get(key);
  if (!sink) {
    sink = { port: 0 };
    sinks.set(key, sink);
  }
  return sink;
}

function stop(server: Server | undefined): Promise<void> {
  return new Promise((done) => {
    if (!server) {
      done();
      return;
    }
    server.close(() => {
      done();
    });
    server.closeAllConnections();
  });
}

/** Starts the sink (on the same port as before, after a stop), and returns where. */
async function sinkStart(sink: Sink): Promise<{ endpoint: string; token: string }> {
  sink.dir ??= await mkdtemp(join(tmpdir(), 'field-notes-browser-sink-'));
  if (!sink.server) {
    const handler = createSinkHandler({ dir: sink.dir, token: TOKEN, defaultAuthor: false });
    const running = createServer((req, res) => {
      handler(req, res);
    });
    await new Promise<void>((done) => running.listen(sink.port, '127.0.0.1', done));
    sink.port = (running.address() as AddressInfo).port;
    sink.server = running;
  }
  return { endpoint: `http://127.0.0.1:${String(sink.port)}/__field-notes`, token: TOKEN };
}

/** Stops it, keeping its notes and port: the sink is "down". */
async function sinkStop(sink: Sink): Promise<void> {
  const { server } = sink;
  sink.server = undefined;
  await stop(server);
}

/** A server that takes requests and never answers them. */
async function sinkHanging(sink: Sink): Promise<string> {
  if (!sink.hanging) {
    const running = createServer(() => undefined);
    await new Promise<void>((done) => running.listen(0, '127.0.0.1', done));
    sink.hanging = running;
  }
  return `http://127.0.0.1:${String((sink.hanging.address() as AddressInfo).port)}/__field-notes`;
}

/**
 * Removes a sink's directory. A request the browser aborted can still be
 * storing its note when the sink is reset, and a file landing mid-removal
 * fails it with ENOTEMPTY: retried, it's removed once that write is done.
 */
export async function removeSinkDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

/** Stops it and forgets its notes and port. */
async function sinkReset(sink: Sink): Promise<void> {
  await sinkStop(sink);
  const { hanging, dir } = sink;
  sink.hanging = undefined;
  sink.dir = undefined;
  sink.port = 0;
  await stop(hanging);
  if (dir) await removeSinkDir(dir);
}

/** Every stored note, with its attachments as base64. */
async function sinkNotes(
  sink: Sink,
): Promise<{ note: unknown; attachments: Record<string, string> }[]> {
  if (!sink.dir) return [];
  const items = join(sink.dir, 'items');
  const names = await readdir(items).catch(() => []);
  return Promise.all(
    names.map(async (name) => {
      const files = await readdir(join(items, name));
      const parsed = parseNote(await readFile(join(items, name, 'note.md'), 'utf8'));
      if (!parsed.ok) throw parsed.error;
      const attachments: Record<string, string> = {};
      for (const file of files.filter((f) => f !== 'note.md')) {
        attachments[file] = (await readFile(join(items, name, file))).toString('base64');
      }
      return { note: parsed.value, attachments };
    }),
  );
}

export const sinkCommands = {
  sinkStart: (context: BrowserCommandContext) => sinkStart(sinkFor(context)),
  sinkStop: (context: BrowserCommandContext) => sinkStop(sinkFor(context)),
  sinkReset: (context: BrowserCommandContext) => sinkReset(sinkFor(context)),
  sinkHanging: (context: BrowserCommandContext) => sinkHanging(sinkFor(context)),
  sinkNotes: (context: BrowserCommandContext) => sinkNotes(sinkFor(context)),
};
