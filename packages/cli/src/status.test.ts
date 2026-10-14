import { chmod, mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Note, parseNote, serializeNote } from '@field-notes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliIo, run } from './index.ts';
import { readBacklog } from './notes.ts';
import { prune } from './status.ts';

const NOW = Date.parse('2026-10-14T12:00:00.000Z');
const DAY = 86_400_000;

let root: string;
let dir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'field-notes-status-'));
  dir = join(root, '.field-notes');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function note(id: string, fields: Partial<Note> = {}): Note {
  return {
    id,
    schema: 1,
    status: 'open',
    created: '2026-09-01T00:00:00.000Z',
    body: `Note ${id}`,
    ...fields,
  };
}

/** Writes `items/<name>/note.md`, last changed `age` ms before NOW. */
async function add(value: Note | string, name: string, age = 0): Promise<string> {
  const itemDir = join(dir, 'items', name);
  await mkdir(itemDir, { recursive: true });
  const file = join(itemDir, 'note.md');
  await writeFile(file, typeof value === 'string' ? value : serializeNote(value));
  const when = new Date(NOW - age);
  await utimes(file, when, when);
  return itemDir;
}

const text = (itemDir: string): Promise<string> => readFile(join(itemDir, 'note.md'), 'utf8');

async function read(itemDir: string): Promise<Note> {
  const parsed = parseNote(await text(itemDir));
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
}

async function cli(...argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = '';
  let stderr = '';
  const io: CliIo = {
    version: '1.2.3',
    stdout: (t) => {
      stdout += t;
    },
    stderr: (t) => {
      stderr += t;
    },
    widgetScript: () => Promise.resolve(''),
    signal: AbortSignal.abort(),
    now: () => NOW,
  };
  const code = await run([...argv, '--dir', dir], io);
  return { code, stdout, stderr };
}

describe('resolve, wontfix and reopen', () => {
  // A hand-edited file: BOM, CRLF, a comment, flow style, unknown fields at
  // every level, and a body with --- lines, a Notes section and trailing space.
  const ORIGINAL = [
    '﻿---',
    'id: 01JA8X3Q7K2M9V5T0N4R6P8W1Y',
    'schema: 1',
    'status: open # triaged on Monday',
    'type: change',
    "created: '2026-10-09T18:42:11.204Z'",
    'element: { selector: "#pay", ownerTeam: { name: web } }',
    'context:',
    '  appVersion: 1.4.0-dev',
    '  flags: [beta, new-checkout]',
    'priority: p2',
    'resolution: null',
    '---',
    '',
    'The button should say "Start free trial".',
    '',
    '---',
    '',
    '## Notes',
    '',
    'Asked design.   ',
    '',
  ].join('\r\n');

  it('changes only status and resolution: the body and unknown fields stay as they were', async () => {
    const itemDir = await add(ORIGINAL, 'hand-edited');
    expect(
      await cli('resolve', '01JA8X', '--note', 'Changed the label', '--ref', 'a1b2c3d'),
    ).toEqual({ code: 0, stdout: 'Resolved 01JA8X3Q7K2M9V5T0N4R6P8W1Y\n', stderr: '' });
    expect(await text(itemDir)).toBe(
      ORIGINAL.replace('status: open #', 'status: resolved #').replace(
        'resolution: null',
        'resolution: "Changed the label (ref: a1b2c3d)"',
      ),
    );
    expect((await cli('reopen', '01JA8X')).stdout).toBe('Reopened 01JA8X3Q7K2M9V5T0N4R6P8W1Y\n');
    expect(await text(itemDir)).toBe(ORIGINAL);
    await cli('wontfix', '01JA8X', '--note', 'Out of scope');
    expect(await text(itemDir)).toBe(
      ORIGINAL.replace('status: open #', 'status: wontfix #').replace(
        'resolution: null',
        'resolution: Out of scope',
      ),
    );
  });

  it('keeps a comment after an empty resolution', async () => {
    const original = ORIGINAL.replace('resolution: null', 'resolution: # later');
    const itemDir = await add(original, 'hand-edited');
    await cli('resolve', '01JA8X', '--note', 'fixed');
    expect(await text(itemDir)).toBe(
      original
        .replace('status: open #', 'status: resolved #')
        .replace('resolution: #', 'resolution: fixed #'),
    );
    expect((await read(itemDir)).resolution).toBe('fixed');
    await cli('reopen', '01JA8X');
    expect(await text(itemDir)).toBe(original.replace('resolution: #', 'resolution: null #'));
  });

  it.each([['yes'], ['2026-10-14'], ['0123'], ['Two lines:\nfirst, then second'], ['a: b # c']])(
    'keeps %j a string, as given',
    async (why) => {
      const itemDir = await add(note('A'), 'a');
      await cli('resolve', 'A', '--note', why);
      expect(await read(itemDir)).toMatchObject({ status: 'resolved', resolution: why });
    },
  );

  it('changes every note named, each once', async () => {
    const a = await add(note('A'), 'a');
    const b = await add(note('B'), 'b');
    expect(await cli('wontfix', 'A', 'B', 'a', '--note', 'Not now')).toEqual({
      code: 0,
      stdout: "Marked won't fix: A\nMarked won't fix: B\n",
      stderr: '',
    });
    expect((await read(a)).status).toBe('wontfix');
    expect((await read(b)).resolution).toBe('Not now');
  });

  it('changes nothing, and exits 1, when any id fits no note or more than one', async () => {
    const a = await add(note('A'), 'a');
    const before = await text(a);
    await add(note('BC'), 'bc');
    await add(note('BD'), 'bd');
    const { code, stdout, stderr } = await cli('resolve', 'A', 'Z', 'B', '--note', 'Done');
    expect({ code, stdout }).toEqual({ code: 1, stdout: '' });
    expect(stderr).toContain('No note has the id "Z".\n');
    expect(stderr).toContain('"B" could be any of these notes:\n');
    expect(stderr).toMatch(/Nothing was changed\.\n$/);
    expect(await text(a)).toBe(before);
  });

  it('leaves a note that already has the status and resolution alone', async () => {
    const itemDir = await add(note('A', { status: 'resolved', resolution: 'Done' }), 'a', DAY);
    expect((await cli('resolve', 'A', '--note', 'Done')).stdout).toBe('A is already resolved\n');
    expect((await cli('reopen', 'A')).stdout).toBe('Reopened A\n');
    expect((await cli('reopen', 'A')).stdout).toBe('A is already open\n');
    expect((await read(itemDir)).resolution).toBeNull();
    // A new reason is a change, though the status isn't.
    await add(note('B', { status: 'wontfix', resolution: 'Later' }), 'b');
    expect((await cli('wontfix', 'B', '--note', 'Never')).stdout).toBe("Marked won't fix: B\n");
  });

  it('adds no resolution to a note that had none when reopening it', async () => {
    const original = serializeNote(note('A', { status: 'wontfix' }));
    const itemDir = await add(original, 'a');
    await cli('reopen', 'A');
    expect(await text(itemDir)).toBe(original.replace('status: wontfix', 'status: open'));
  });

  it.runIf(process.getuid?.() !== 0)(
    'says which note it could not change, changes the rest, and exits 1',
    async () => {
      const a = await add(note('A'), 'a');
      const b = await add(note('B'), 'b');
      await chmod(a, 0o555);
      try {
        const { code, stdout, stderr } = await cli('resolve', 'A', 'B', '--note', 'Done');
        expect({ code, stdout }).toEqual({ code: 1, stdout: 'Resolved B\n' });
        expect(stderr).toMatch(/^Couldn't change A: EACCES/);
        expect((await read(b)).status).toBe('resolved');
        expect((await read(a)).status).toBe('open');
      } finally {
        await chmod(a, 0o755);
      }
    },
  );

  it.each([
    [['resolve', '--note', 'x'], 'resolve takes one or more note ids'],
    [['resolve', 'A'], 'resolve needs --note, saying why'],
    [['wontfix', 'A', '--note', '  '], 'wontfix needs --note, saying why'],
    [['reopen', 'A', '--note', 'x'], "reopen doesn't take --note"],
    [['resolve', 'A', '--note', 'x', '--json'], "resolve doesn't take --json"],
  ])('refuses %j with exit code 2', async (args, message) => {
    await add(note('A'), 'a');
    const { code, stderr } = await cli(...args);
    expect(code).toBe(2);
    expect(stderr).toContain(message);
  });
});

describe('prune', () => {
  const OLD = 31 * DAY;

  async function backlog(): Promise<{ resolvedOld: string; wontfixOld: string }> {
    await add(note('OPEN'), 'open', OLD);
    await add(note('NEW', { status: 'resolved' }), 'new', 29 * DAY);
    await add('status: resolved', 'broken', OLD);
    return {
      resolvedOld: await add(note('RES', { status: 'resolved' }), 'res', OLD),
      wontfixOld: await add(note('WONT', { status: 'wontfix' }), 'wont', OLD),
    };
  }

  const left = async (): Promise<string[]> => (await readdir(join(dir, 'items'))).sort();

  it('deletes resolved and wontfix notes unchanged for --older-than, never open ones', async () => {
    const { resolvedOld, wontfixOld } = await backlog();
    // Still being written: no note.md yet.
    await mkdir(join(dir, 'items', 'writing'));
    const { code, stdout, stderr } = await cli('prune', '--older-than', '30d');
    expect(code).toBe(0);
    expect(stdout).toBe(`Deleted RES  ${resolvedOld}\nDeleted WONT  ${wontfixOld}\n`);
    expect(stderr).toContain('Skipped');
    expect(await left()).toEqual(['broken', 'new', 'open', 'writing']);
  });

  it('deletes only the statuses given', async () => {
    await backlog();
    await cli('prune', '--older-than', '30d', '--status', 'wontfix');
    expect(await left()).toEqual(['broken', 'new', 'open', 'res']);
  });

  it('lists what it would delete with --dry-run, deleting nothing', async () => {
    const { resolvedOld, wontfixOld } = await backlog();
    const { stdout } = await cli('prune', '--older-than', '30d', '--dry-run');
    expect(stdout).toBe(`Would delete RES  ${resolvedOld}\nWould delete WONT  ${wontfixOld}\n`);
    expect(await left()).toEqual(['broken', 'new', 'open', 'res', 'wont']);
  });

  it('says so on stderr when there is nothing to delete', async () => {
    await backlog();
    expect(await cli('prune', '--older-than', '5w', '--status', 'resolved')).toEqual({
      code: 0,
      stdout: '',
      stderr: expect.stringContaining('No notes to delete.\n') as string,
    });
  });

  it('keeps a note reopened since the backlog was read', async () => {
    const itemDir = await add(note('A', { status: 'resolved' }), 'a', OLD);
    const { items } = await readBacklog(dir);
    await writeFile(join(itemDir, 'note.md'), serializeNote(note('A')));
    const when = new Date(NOW - OLD);
    await utimes(join(itemDir, 'note.md'), when, when);
    expect(await prune(items, ['resolved'], 30 * DAY, NOW, false)).toEqual([]);
    await rm(itemDir, { recursive: true });
    // Or deleted since.
    expect(await prune(items, ['resolved'], 30 * DAY, NOW, false)).toEqual([]);
  });

  it('never deletes open notes, whatever it is asked', async () => {
    const itemDir = await add(note('A'), 'a', OLD);
    const { items } = await readBacklog(dir);
    expect(await prune(items, ['open', 'resolved', 'wontfix'], 0, NOW, false)).toEqual([]);
    expect(await read(itemDir)).toMatchObject({ status: 'open' });
  });

  it('forgets the records of client ids older than the widget resends', async () => {
    const keys = join(dir, '.sink', 'keys');
    await mkdir(keys, { recursive: true });
    const record = (n: string): string => `${n.repeat(64)}.json`;
    const files: [string, number][] = [
      [record('a'), 8 * DAY],
      [record('b'), 6 * DAY],
      [`${record('c')}.1234.tmp`, 8 * DAY],
      ['notes.json', 8 * DAY],
    ];
    for (const [name, age] of files) {
      await writeFile(join(keys, name), '{}');
      await utimes(join(keys, name), new Date(NOW - age), new Date(NOW - age));
    }
    await cli('prune', '--older-than', '30d', '--dry-run');
    expect(await readdir(keys)).toHaveLength(4);
    await cli('prune', '--older-than', '30d');
    expect((await readdir(keys)).sort()).toEqual(
      [record('b'), `${record('c')}.1234.tmp`, 'notes.json'].sort(),
    );
  });

  it('fails with exit code 1 when the notes cannot be read', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'items'), '');
    expect((await cli('prune', '--older-than', '1d')).code).toBe(1);
    expect((await cli('resolve', 'A', '--note', 'x')).code).toBe(1);
  });

  it.runIf(process.getuid?.() !== 0)('fails with exit code 1 when it cannot delete', async () => {
    await add(note('A', { status: 'resolved' }), 'a', OLD);
    await chmod(join(dir, 'items'), 0o555);
    try {
      const { code, stderr } = await cli('prune', '--older-than', '30d');
      expect(code).toBe(1);
      expect(stderr).toContain("Couldn't prune");
    } finally {
      await chmod(join(dir, 'items'), 0o755);
    }
  });

  it.each([
    [['prune'], 'prune needs --older-than'],
    [['prune', '--older-than', '2026-10-01'], 'prune needs --older-than'],
    [['prune', '--older-than', '1d', '--status', 'open'], 'prune never deletes open notes'],
    [['prune', '--older-than', '1d', '--status', 'all'], 'prune never deletes open notes'],
    [['prune', 'A', '--older-than', '1d'], 'prune takes no arguments'],
  ])('refuses %j with exit code 2', async (args, message) => {
    const { code, stderr } = await cli(...args);
    expect(code).toBe(2);
    expect(stderr).toContain(message);
  });
});
