import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rename, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { type Note, serializeNote } from '@field-notes/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type CliIo, run } from './index.ts';

const NOW = Date.parse('2026-10-14T12:00:00.000Z');
// Watch events can lag on CI runners, macOS's most.
const WAIT = { timeout: 15_000, interval: 20 };
// Long enough for a stray duplicate to show up.
const SETTLE_MS = 500;

let root: string;
let dir: string;
const running: Tailing[] = [];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'field-notes-tail-'));
  dir = join(root, '.field-notes');
  await mkdir(join(dir, 'items'), { recursive: true });
});

afterEach(async () => {
  await Promise.all(running.splice(0).map((t) => t.stop()));
  await rm(root, { recursive: true, force: true });
});

function note(id: string, fields: Partial<Note> = {}): Note {
  return {
    id,
    schema: 1,
    status: 'open',
    created: '2026-10-14T11:00:00.000Z',
    body: `Note ${id}`,
    ...fields,
  };
}

/** Writes a file as the sink does: to a temp name, then renamed. */
async function land(itemDir: string, file: string, text: string): Promise<void> {
  const temp = join(itemDir, `.${file}.${randomUUID()}.tmp`);
  await writeFile(temp, text, { flag: 'wx' });
  await rename(temp, join(itemDir, file));
}

/** Writes a note as the sink does: its directory, a screenshot, then note.md. */
async function add(value: Note, name = value.id): Promise<string> {
  const itemDir = join(dir, 'items', name);
  await mkdir(itemDir);
  await land(itemDir, 'screenshot.png', 'png');
  await land(itemDir, 'note.md', serializeNote({ ...value, screenshot: 'screenshot.png' }));
  return itemDir;
}

async function cli(...argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = '';
  let stderr = '';
  const io: CliIo = {
    version: '1.2.3',
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    widgetScript: () => Promise.resolve(''),
    signal: AbortSignal.abort(),
    now: () => NOW,
  };
  const code = await run([...argv, '--dir', dir], io);
  return { code, stdout, stderr };
}

interface Tailing {
  readonly out: () => string[];
  readonly err: () => string;
  readonly stop: () => Promise<number>;
}

/** Starts `tail`, resolving once it says it's watching (or waiting). */
async function startTail(...argv: string[]): Promise<Tailing> {
  let stdout = '';
  let stderr = '';
  const stop = new AbortController();
  const io: CliIo = {
    version: '1.2.3',
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    widgetScript: () => Promise.resolve(''),
    signal: stop.signal,
    now: () => NOW,
  };
  const exited = run(['tail', ...argv, '--dir', dir], io);
  const tailing: Tailing = {
    out: () => stdout.split('\n').filter(Boolean),
    err: () => stderr,
    stop: () => {
      stop.abort();
      return exited;
    },
  };
  running.push(tailing);
  await vi.waitFor(() => {
    expect(stderr).toMatch(/Watching |Waiting /);
  }, WAIT);
  return tailing;
}

const ids = (lines: readonly string[]): string[] => lines.map((l) => l.split('  ')[0] ?? '');

describe('tail', () => {
  it('prints each note that lands after it starts, and none from before', async () => {
    await add(note('OLD'));
    const t = await startTail();
    expect(t.err()).toBe(`Watching ${join(dir, 'items')} for new notes. Ctrl+C stops.\n`);
    await add(note('NEW', { type: 'bug', route: '/checkout', body: 'Total is off\nby one' }));
    await vi.waitFor(() => {
      expect(t.out()).toEqual(['NEW  bug  /checkout  Total is off']);
    }, WAIT);
    await add(note('NEXT'));
    await vi.waitFor(() => {
      expect(ids(t.out())).toEqual(['NEW', 'NEXT']);
    }, WAIT);
    expect(t.out()[1]).toBe('NEXT  -  -  Note NEXT');
    expect(await t.stop()).toBe(0);
  });

  it('prints each note of a burst exactly once', async () => {
    const t = await startTail('--json');
    const burst = Array.from({ length: 50 }, (_, i) => `B${String(i).padStart(2, '0')}`);
    await Promise.all(burst.map((id) => add(note(id))));
    await vi.waitFor(() => {
      expect(t.out()).toHaveLength(50);
    }, WAIT);
    // More events, none of them a new note.
    await cli('resolve', 'B00', '--note', 'Done');
    await writeFile(join(dir, 'items', 'B01', 'extra.txt'), 'x');
    await sleep(SETTLE_MS);
    const printed = t.out().map((l) => (JSON.parse(l) as { note: Note }).note.id);
    expect(printed.sort()).toEqual(burst);
  });

  it('prints JSON lines in the shape of list --json', async () => {
    const t = await startTail('--json');
    const itemDir = await add(note('J', { route: '/a' }));
    await vi.waitFor(() => {
      expect(t.out()).toHaveLength(1);
    }, WAIT);
    expect(JSON.parse(t.out()[0] ?? '')).toEqual({
      dir: itemDir,
      screenshot: join(itemDir, 'screenshot.png'),
      note: { ...note('J', { route: '/a' }), screenshot: 'screenshot.png' },
    });
  });

  it('prints notes already there and created since --since first', async () => {
    await add(note('OLDER', { created: '2026-10-12T00:00:00.000Z' }));
    await add(note('RECENT', { created: '2026-10-14T10:00:00.000Z' }));
    const t = await startTail('--since', '1d');
    expect(t.out()).toEqual(['RECENT  -  -  Note RECENT']);
    await add(note('NEW', { created: '2026-10-01T00:00:00.000Z' }));
    await vi.waitFor(() => {
      expect(ids(t.out())).toEqual(['RECENT', 'NEW']);
    }, WAIT);
  });

  it('prints a note whose note.md lands well after its directory, once', async () => {
    const t = await startTail();
    const itemDir = join(dir, 'items', 'SLOW');
    await mkdir(itemDir);
    await sleep(300);
    await land(itemDir, 'note.md', serializeNote(note('SLOW')));
    await vi.waitFor(() => {
      expect(ids(t.out())).toEqual(['SLOW']);
    }, WAIT);
    await sleep(SETTLE_MS);
    expect(t.out()).toHaveLength(1);
  });

  it('reports a note that isn’t valid once, and prints it if it’s fixed', async () => {
    const t = await startTail();
    const itemDir = join(dir, 'items', 'BAD');
    await mkdir(itemDir);
    await land(itemDir, 'note.md', 'not a note');
    await vi.waitFor(() => {
      expect(t.err()).toContain(`Skipped ${itemDir}: `);
    }, WAIT);
    await add(note('GOOD'));
    await vi.waitFor(() => {
      expect(ids(t.out())).toEqual(['GOOD']);
    }, WAIT);
    expect(t.err().split('Skipped')).toHaveLength(2);
    await land(itemDir, 'note.md', serializeNote(note('BAD')));
    await vi.waitFor(() => {
      expect(ids(t.out())).toEqual(['GOOD', 'BAD']);
    }, WAIT);
  });

  it('keeps going while notes are resolved and pruned', async () => {
    const old = await add(note('A'));
    const t = await startTail();
    await cli('resolve', 'A', '--note', 'Done');
    await utimes(join(old, 'note.md'), new Date(0), new Date(0));
    expect((await cli('prune', '--older-than', '1d')).stdout).toMatch(/^Deleted A/);
    await add(note('B'));
    await vi.waitFor(() => {
      expect(ids(t.out())).toEqual(['B']);
    }, WAIT);
  });

  it('waits for items/ to be made', async () => {
    await rm(dir, { recursive: true });
    const t = await startTail();
    expect(t.err()).toBe(`Waiting for ${join(dir, 'items')} to be made…\n`);
    await mkdir(join(dir, 'items'), { recursive: true });
    await vi.waitFor(() => {
      expect(t.err()).toContain('Watching ');
    }, WAIT);
    await add(note('FIRST'));
    await vi.waitFor(() => {
      expect(ids(t.out())).toEqual(['FIRST']);
    }, WAIT);
  });

  it('exits 0 when stopped while waiting', async () => {
    await rm(dir, { recursive: true });
    const t = await startTail();
    expect(await t.stop()).toBe(0);
    expect(t.out()).toEqual([]);
  });

  it.each([
    [['--since', 'soon'], '--since must be like'],
    [['--status', 'open'], "tail doesn't take --status"],
    [['extra'], 'tail takes no arguments'],
  ])('exits 2 for %j', async (argv, error) => {
    const { code, stderr } = await cli('tail', ...argv);
    expect(code).toBe(2);
    expect(stderr.startsWith(error)).toBe(true);
  });
});
