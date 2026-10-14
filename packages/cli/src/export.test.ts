import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { type Note, serializeNote } from '@field-notes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliIo, run } from './index.ts';

const NOW = Date.parse('2026-10-14T12:00:00.000Z');

let root: string;
let dir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'field-notes-export-'));
  // A space and parentheses, which a screenshot link has to encode.
  dir = join(root, 'team notes (q4)');
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

async function add(value: Note, files: Record<string, string> = {}): Promise<string> {
  const itemDir = join(dir, 'items', value.id);
  await mkdir(itemDir, { recursive: true });
  for (const [file, text] of Object.entries(files)) await writeFile(join(itemDir, file), text);
  await writeFile(join(itemDir, 'note.md'), serializeNote(value));
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
  const code = await run(['export', ...argv, '--dir', dir], io);
  return { code, stdout, stderr };
}

/**
 * Notes with what a digest has to get right: groups, missing fields, a
 * missing screenshot, non-ASCII text, and text written to break out of each
 * format.
 */
async function fixture(): Promise<void> {
  await add(
    note('01JA8X3Q7K2M9V5T0N4R6P8W1Y', {
      created: '2026-10-09T18:42:11.204Z',
      type: 'change',
      author: 'Sam Rivera',
      environment: 'staging',
      url: 'https://app.test/checkout?step=2',
      route: '/checkout',
      title: 'Checkout · Café',
      element: { selector: 'button[data-test="pay"]' },
      selection: 'Place order',
      tags: ['copy', 'beta'],
      screenshot: 'screenshot.png',
      body: [
        'The button should say "Start free trial".',
        '',
        '# Not a heading of the digest',
        '---',
        '<img src="https://tracker.test/pixel.png">',
        '![pixel](https://tracker.test/pixel.png) and [click](javascript:alert(1))',
        'Résumé ✓, \\<b> stays text',
      ].join('\n'),
    }),
    { 'screenshot.png': 'png' },
  );
  await add(
    note('01JA8X4B', {
      created: '2026-10-10T09:00:00.000Z',
      type: 'Bug',
      author: '=HYPERLINK("https://evil.test","x")',
      route: '/checkout',
      title: 'Totals | *wrong* <b>',
      element: { selector: 'span`total`' },
      screenshot: 'screenshot.webp',
      body: '- the total is off\n- by "one", maybe',
    }),
  );
  await add(
    note('01JA8X5C', {
      created: '2026-10-11T10:30:00.000Z',
      body: '@everyone, no route, no type.\n\nSecond paragraph.',
    }),
  );
  await add(
    note('01JA8X6D', {
      created: '2026-10-12T08:00:00.000Z',
      type: 'change',
      route: '/settings',
      body: '',
    }),
  );
  await add(note('01JA8X7E', { status: 'resolved', resolution: 'Done', route: '/checkout' }));
}

/** The digest `export --out` writes, with the temp directory made constant. */
async function exported(...argv: string[]): Promise<string> {
  const out = join(root, 'digest');
  const result = await cli(...argv, '--out', out);
  expect(result).toMatchObject({ code: 0, stdout: '' });
  return (await readFile(out, 'utf8')).replaceAll(root, '<root>');
}

describe('export', () => {
  it.each([['md'], ['json'], ['csv']])('writes the %s digest', async (format) => {
    await fixture();
    await expect(await exported('--format', format)).toMatchFileSnapshot(
      `__golden__/export.${format}`,
    );
  });

  // File snapshots compare line breaks loosely, so these are checked here.
  it('writes CSV with a byte order mark and CRLF line breaks', async () => {
    await fixture();
    const text = await exported('--format', 'csv');
    expect(text.startsWith('﻿id,status,')).toBe(true);
    expect(text.match(/\r\n01JA8X/g)).toHaveLength(4);
    expect(text.endsWith(',\r\n')).toBe(true);
  });

  it('groups by type in any case, and by author', async () => {
    await fixture();
    const byType = await exported('--group-by', 'type', '--type', 'bug', '--type', 'change');
    expect(byType.match(/^## .*/gm)).toEqual(['## change (2)', '## Bug (1)']);
    const byAuthor = await exported('--group-by', 'author', '--format', 'json');
    expect(
      (JSON.parse(byAuthor) as { groups: { value: string | null }[] }).groups.map((g) => g.value),
    ).toEqual(['Sam Rivera', '=HYPERLINK("https://evil.test","x")', null]);
  });

  it('prints to stdout, with screenshot paths relative to the current directory', async () => {
    await fixture();
    const { code, stdout, stderr } = await cli('--route', '/checkout');
    expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
    const shot = join(dir, 'items', '01JA8X3Q7K2M9V5T0N4R6P8W1Y', 'screenshot.png');
    const path = relative(process.cwd(), shot).split('\\').join('/');
    expect(stdout).toContain(`- **screenshot:** \`${path}\``);
    expect(stdout).toContain('2 notes (open), by route.');
  });

  it('filters as list does', async () => {
    await fixture();
    const all = await exported('--status', 'all', '--since', '2026-10-09T00:00:00Z');
    expect(all).toContain('5 notes (open, resolved, wontfix), by route.');
    expect(all).toContain('## /checkout (3)');
  });

  it('says so on stderr when no notes match, and still writes a digest', async () => {
    await fixture();
    expect(await cli('--type', 'none', '--format', 'json')).toEqual({
      code: 0,
      stdout: '{\n  "groupBy": "route",\n  "groups": []\n}\n',
      stderr: 'No notes match.\n',
    });
    expect((await cli('--type', 'none', '--format', 'csv')).stdout.split('\r\n')).toHaveLength(2);
  });

  it('reports where it wrote the digest', async () => {
    await fixture();
    const out = join(root, 'digest.md');
    expect(await cli('--out', out)).toEqual({
      code: 0,
      stdout: '',
      stderr: `Wrote 4 notes to ${out}\n`,
    });
  });

  it('exits 1 when it can’t write --out', async () => {
    await fixture();
    const out = join(root, 'missing', 'digest.md');
    const { code, stderr } = await cli('--out', out);
    expect(code).toBe(1);
    expect(stderr).toMatch(new RegExp(`^Couldn't write ${out.replaceAll('\\', '\\\\')}: `));
  });

  it.each([
    [['--format', 'pdf'], '--format must be md, json, csv, not "pdf"\n'],
    [['--group-by', 'title'], '--group-by must be route, type, author, not "title"\n'],
    [['--status', 'done'], '--status must be open, resolved, wontfix or all, not "done"\n'],
    [['--json'], "export doesn't take --json"],
    [['extra'], 'export takes no arguments'],
  ])('exits 2 for %j', async (argv, error) => {
    const { code, stderr } = await cli(...argv);
    expect(code).toBe(2);
    expect(stderr.startsWith(error)).toBe(true);
  });

  it('exits 1 when the notes directory can’t be read', async () => {
    await mkdir(root, { recursive: true });
    await writeFile(dir, 'not a directory');
    const { code, stderr } = await cli();
    expect(code).toBe(1);
    expect(stderr).toMatch(/^Can't read notes in /);
  });
});
