import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Note, NoteSchema, serializeNote } from '@field-notes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliIo, run } from './index.ts';

const NOW = Date.parse('2026-10-14T12:00:00.000Z');

let root: string;
let dir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'field-notes-list-'));
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
    created: '2026-10-09T18:42:11.204Z',
    body: `Note ${id}`,
    ...fields,
  };
}

/** Writes `note.md` (and any files) into `items/<name>/`, as the sink would. */
async function add(
  value: Note | string,
  name = typeof value === 'string' ? 'raw' : value.id,
  files: Record<string, string> = {},
): Promise<string> {
  const itemDir = join(dir, 'items', name);
  await mkdir(itemDir, { recursive: true });
  for (const [file, text] of Object.entries(files)) await writeFile(join(itemDir, file), text);
  await writeFile(
    join(itemDir, 'note.md'),
    typeof value === 'string' ? value : serializeNote(value),
  );
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

async function json<T>(...argv: string[]): Promise<T> {
  const { code, stdout, stderr } = await cli(...argv, '--json');
  expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
  return JSON.parse(stdout) as T;
}

interface Item {
  dir: string;
  screenshot: string | null;
  note: Note;
}
const ids = (items: Item[]): string[] => items.map((item) => item.note.id);

describe('list', () => {
  it('lists open notes, oldest first, a row each, with - for what a note lacks', async () => {
    await add(note('B', { created: '2026-10-10T00:00:00.000Z', type: 'bug', route: '/cart' }));
    await add(note('A', { body: '\n\nFirst line\nsecond line' }));
    await add(note('C', { status: 'resolved' }));
    const { code, stdout, stderr } = await cli('list');
    expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
    expect(stdout).toBe('A  open  -    -      First line\nB  open  bug  /cart  Note B\n');
  });

  it('orders notes created at the same time by id', async () => {
    await add(note('02'));
    await add(note('01'));
    expect(ids(await json<Item[]>('list'))).toEqual(['01', '02']);
  });

  it('cuts a long first line to fit a row', async () => {
    await add(note('A', { body: 'x'.repeat(100) }));
    const { stdout } = await cli('list');
    expect(stdout).toBe(`A  open  -  -  ${'x'.repeat(71)}…\n`);
  });

  describe('filters', () => {
    beforeEach(async () => {
      await add(
        note('A', {
          type: 'Bug',
          author: 'Sam',
          route: '/checkout/pay',
          created: '2026-10-14T11:00:00.000Z',
        }),
      );
      await add(note('B', { type: 'idea', author: 'Ana', route: '/checkout' }));
      await add(note('C', { status: 'resolved', route: '/cart' }));
      await add(note('D', { status: 'wontfix', type: 'bug' }));
    });

    it.each([
      [['--status', 'resolved'], ['C']],
      [
        ['--status', 'resolved', '--status', 'wontfix'],
        ['C', 'D'],
      ],
      [
        ['--status', 'all'],
        ['B', 'C', 'D', 'A'],
      ],
      [
        ['--status', 'all', '--type', 'BUG'],
        ['D', 'A'],
      ],
      [
        ['--type', 'idea', '--type', 'bug'],
        ['B', 'A'],
      ],
      [['--author', 'sam'], ['A']],
      [['--route', '/checkout'], ['B']],
      [['--route', '/checkout/*'], ['A']],
      [
        ['--route', '/checkout*', '--status', 'all'],
        ['B', 'A'],
      ],
      [
        ['--route', '/c*t', '--status', 'all'],
        ['B', 'C'],
      ],
      [['--route', '.*'], []],
      [['--since', '2h'], ['A']],
      [['--since', '30m'], []],
      [
        ['--since', '1w'],
        ['B', 'A'],
      ],
      [['--since', '2026-10-14'], ['A']],
      [['--since', '2026-10-14T11:30:00Z'], []],
    ])('%j', async (args, expected) => {
      expect(ids(await json<Item[]>('list', ...args))).toEqual(expected);
    });

    it.each([
      [['--status', 'closed'], '--status must be open, resolved, wontfix or all, not "closed"'],
      [['--since', '2 days'], '--since must be like 30m, 12h, 2d, 1w or 2026-10-01'],
      [['--since', '2026-13-45'], '--since must be'],
      [['--since', '2026-02-30'], '--since must be'],
      [['--since', '2026-10-14 09:00'], '--since must be'],
      [['--group-by', 'status'], '--group-by must be route, type, author, not "status"'],
    ])('refuses %j with exit code 2', async (args, message) => {
      const { code, stdout, stderr } = await cli('list', ...args);
      expect({ code, stdout }).toEqual({ code: 2, stdout: '' });
      expect(stderr).toContain(message);
    });

    it('reads a date, and a date-time without an offset, as local time', async () => {
      const zone = process.env.TZ;
      try {
        process.env.TZ = 'America/Los_Angeles';
        // E: 8 p.m. on the 13th in Los Angeles, though it's the 14th in UTC.
        await add(note('E', { created: '2026-10-14T03:00:00.000Z' }));
        expect(ids(await json<Item[]>('list', '--since', '2026-10-14'))).toEqual(['A']);
        expect(ids(await json<Item[]>('list', '--since', '2026-10-13T19:00'))).toEqual(['E', 'A']);
        expect(ids(await json<Item[]>('list', '--since', '2026-10-13T19:00Z'))).toEqual(['E', 'A']);
        process.env.TZ = 'UTC';
        expect(ids(await json<Item[]>('list', '--since', '2026-10-14'))).toEqual(['E', 'A']);
      } finally {
        if (zone === undefined) delete process.env.TZ;
        else process.env.TZ = zone;
      }
    });

    it('says so on stderr when nothing matches, and prints [] with --json', async () => {
      expect(await cli('list', '--author', 'nobody')).toEqual({
        code: 0,
        stdout: '',
        stderr: 'No notes match.\n',
      });
      expect(await json('list', '--author', 'nobody')).toEqual([]);
    });
  });

  it('groups rows under a heading per group, notes without a value last in their own', async () => {
    await add(note('A', { author: 'Sam', created: '2026-10-09T00:00:00.000Z' }));
    await add(note('B', { created: '2026-10-10T00:00:00.000Z' }));
    await add(note('C', { author: 'Sam', created: '2026-10-11T00:00:00.000Z' }));
    const { stdout } = await cli('list', '--group-by', 'author');
    expect(stdout).toBe(
      'Sam (2)\n  A  open  -  -  Note A\n  C  open  -  -  Note C\n\n' +
        '(no author) (1)\n  B  open  -  -  Note B\n',
    );
    // JSON keeps one shape: grouping only orders it.
    expect(ids(await json<Item[]>('list', '--group-by', 'author'))).toEqual(['A', 'C', 'B']);
  });

  it('groups types and authors in any case, as it filters them, but not routes', async () => {
    await add(note('A', { type: 'Bug', route: '/Cart' }));
    await add(note('B', { type: 'bug', route: '/cart' }));
    expect((await cli('list', '--group-by', 'type')).stdout).toBe(
      'Bug (2)\n  A  open  Bug  /Cart  Note A\n  B  open  bug  /cart  Note B\n',
    );
    expect((await cli('list', '--group-by', 'route')).stdout).toContain('/Cart (1)\n');
  });

  it('prints each note as { dir, screenshot, note }, the note exactly as in note.md', async () => {
    const full = note('01JA8X3Q7K2M9V5T0N4R6P8W1Y', {
      type: 'change',
      author: 'Sam',
      route: '/checkout',
      screenshot: 'screenshot.png',
      tags: ['copy'],
      resolution: null,
    });
    const itemDir = await add(full, `${full.id}-checkout`, { 'screenshot.png': 'png' });
    expect(await json('list')).toEqual([
      { dir: itemDir, screenshot: join(itemDir, 'screenshot.png'), note: full },
    ]);
  });

  it('keeps unknown fields, nested ones too, in --json, and lists such notes as usual', async () => {
    const odd = note('A', {
      type: 'needs-design',
      priority: 'p2',
      element: { selector: '#x', ownerTeam: { name: 'web' } },
      context: { appVersion: '1.4.0', flags: { beta: true } },
      viewport: { width: 1, height: 1, orientation: 'portrait' },
    });
    await add(odd);
    const [item] = await json<Item[]>('list');
    expect(item?.note).toEqual(odd);
    expect(NoteSchema.safeParse(item?.note).success).toBe(true);
    expect((await cli('list')).stdout).toBe('A  open  needs-design  -  Note A\n');
  });

  it('prints no control characters from a note, though --json keeps them, escaped', async () => {
    const hostile = note('A', {
      type: 'bug\u001b[2J',
      route: '/a‮b',
      body: 'Title \u001b]0;pwned\u0007here\tand\r\nmore \u009b31m',
      sneaky: '\u001b[31m',
    });
    await add(hostile);
    const list = (await cli('list')).stdout;
    const show = (await cli('show', 'A')).stdout;
    for (const text of [list, show]) {
      // eslint-disable-next-line no-control-regex -- looking for them
      expect(text).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮]/);
    }
    expect(list).toBe('A  open  bug[2J  /ab  Title ]0;pwnedhere and\n');
    expect(show).toContain('\nTitle ]0;pwnedhere\tand\nmore 31m\n');
    const [item] = await json<Item[]>('list');
    expect(item?.note).toEqual(hostile);
  });

  it('prints an id without its control characters too', async () => {
    const one = await add(note('A\u001b[2J\u202eX', { body: 'One' }), 'one');
    const two = await add(note('A\u001b[2J\u202eY', { body: 'Two' }), 'two');
    expect((await cli('list')).stdout).toBe('A[2JX  open  -  -  One\nA[2JY  open  -  -  Two\n');
    expect((await cli('show', 'a\u001b[2J\u202ex')).stdout).toMatch(/^A\[2JX\n/);
    expect((await cli('show', 'a')).stderr).toBe(
      `"a" could be any of these notes:\n  A[2JX  ${one}\n  A[2JY  ${two}\n`,
    );
  });

  describe('directories that hold no note', () => {
    it('skips one without note.md quietly: it is still being written', async () => {
      await add(note('A'));
      await mkdir(join(dir, 'items', 'B-writing'), { recursive: true });
      await writeFile(join(dir, 'items', 'B-writing', 'screenshot.png'), 'png');
      expect(await cli('list')).toEqual({ code: 0, stdout: 'A  open  -  -  Note A\n', stderr: '' });
    });

    it('reports an invalid note and a newer schema on stderr, and lists the rest', async () => {
      await add(note('A'));
      const broken = await add('no frontmatter', 'broken');
      const newer = await add(serializeNote(note('C')).replace('schema: 1', 'schema: 2'), 'newer');
      const { code, stdout, stderr } = await cli('list', '--json');
      expect(code).toBe(0);
      expect(ids(JSON.parse(stdout) as Item[])).toEqual(['A']);
      expect(stderr).toBe(
        `Skipped ${broken}: note.md must start with a --- frontmatter block\n` +
          `Skipped ${newer}: its schema isn't 1, the version this field-notes reads\n`,
      );
    });

    it('skips a note.md that is not a file, and a symlinked directory', async () => {
      const odd = join(dir, 'items', 'odd');
      await mkdir(join(odd, 'note.md'), { recursive: true });
      const elsewhere = join(root, 'elsewhere');
      await mkdir(elsewhere);
      await writeFile(join(elsewhere, 'note.md'), serializeNote(note('X')));
      await symlink(elsewhere, join(dir, 'items', 'linked'));
      expect(await cli('list')).toEqual({
        code: 0,
        stdout: '',
        stderr: `Skipped ${odd}: note.md is not a file\nNo notes match.\n`,
      });
    });

    it('finds no notes, without an error, where there is no items/', async () => {
      expect(await json('list')).toEqual([]);
    });

    it('fails with exit code 1 when items/ cannot be read', async () => {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'items'), 'not a directory');
      const { code, stderr } = await cli('list');
      expect(code).toBe(1);
      expect(stderr).toContain(`Can't read notes in ${dir}: ENOTDIR`);
    });
  });
});

describe('show', () => {
  const ID = '01JA8X3Q7K2M9V5T0N4R6P8W1Y';

  it('shows a note by its id, or the start of it in any case', async () => {
    const itemDir = await add(
      note(ID, {
        type: 'change',
        author: 'Sam',
        url: 'http://localhost:5173/checkout',
        route: '/checkout',
        element: { selector: 'form > button' },
        selection: null,
        tags: ['copy', 'pricing'],
        screenshot: 'screenshot.png',
        body: 'The button should say "Start free trial".\n\n## Notes\n\nAsked design.\n',
      }),
      `${ID}-the-button`,
      { 'screenshot.png': 'png' },
    );
    const expected =
      `${ID}\nstatus: open\ntype: change\nauthor: Sam\ncreated: 2026-10-09T18:42:11.204Z\n` +
      'url: http://localhost:5173/checkout\nroute: /checkout\nelement: form > button\n' +
      `tags: copy, pricing\nscreenshot: ${join(itemDir, 'screenshot.png')}\ndir: ${itemDir}\n\n` +
      'The button should say "Start free trial".\n\n## Notes\n\nAsked design.\n';
    for (const id of [ID, '01ja8x']) {
      expect(await cli('show', id)).toEqual({ code: 0, stdout: expected, stderr: '' });
    }
  });

  it('prints { dir, screenshot, note } with --json, screenshot null when the file is missing', async () => {
    const shown = note(ID, { screenshot: 'screenshot.png' });
    const itemDir = await add(shown);
    expect(await json('show', ID)).toEqual({ dir: itemDir, screenshot: null, note: shown });
    expect((await cli('show', ID)).stdout).toContain(
      "\nscreenshot: screenshot.png (not in the note's directory)\n",
    );
  });

  it('prefers an exact id over longer ids that start with it', async () => {
    await add(note('AB'));
    await add(note('ABC'));
    expect((await json<Item>('show', 'ab')).note.id).toBe('AB');
  });

  it('fails with exit code 1, listing them, when the id fits more than one note', async () => {
    const one = await add(note('ABC'));
    const two = await add(note('ABD'));
    const copy = await add(note('ABC'), 'ABC-copy');
    expect(await cli('show', 'AB')).toEqual({
      code: 1,
      stdout: '',
      stderr: `"AB" could be any of these notes:\n  ABC  ${one}\n  ABC  ${copy}\n  ABD  ${two}\n`,
    });
    // The same id in two directories (a copy by hand) is just as ambiguous.
    expect((await cli('show', 'ABC')).code).toBe(1);
  });

  it('fails with exit code 1 when no note has the id', async () => {
    await add(note('A'));
    expect(await cli('show', 'Z')).toEqual({
      code: 1,
      stdout: '',
      stderr: 'No note has the id "Z".\n',
    });
  });

  it('fails with exit code 1 when items/ cannot be read', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'items'), '');
    expect((await cli('show', 'A')).code).toBe(1);
  });
});

describe('arguments', () => {
  it.each([
    [['show'], 'show takes one note id'],
    [['show', 'A', 'B'], 'show takes one note id'],
    [['list', 'extra'], 'list takes no arguments'],
    [['show', 'A', '--status', 'open'], "show doesn't take --status"],
    [['serve', '--json'], "serve doesn't take --json"],
    [['import', 'x.zip', '--route', '/'], "import doesn't take --route"],
  ])('refuses %j with exit code 2', async (args, message) => {
    const { code, stderr } = await cli(...args);
    expect(code).toBe(2);
    expect(stderr).toContain(message);
  });
});
