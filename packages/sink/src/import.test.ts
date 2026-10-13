import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { type Note, parseNote, serializeNote, writeBundle } from '@field-notes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importBundle } from './import.ts';
import { DEFAULT_GITIGNORE, createStore } from './store.ts';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'field-notes-import-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const note = (id: string, body: string, extra: Partial<Note> = {}): Note => ({
  id,
  schema: 1,
  status: 'open',
  created: '2026-10-09T18:42:11.204Z',
  body,
  ...extra,
});

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]);

/** Every file under `dir`, by relative path, with its bytes. */
async function tree(dir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files[relative(dir, path)] = (await readFile(path)).toString('base64');
  }
  return files;
}

describe('importBundle', () => {
  it('writes notes exactly as the sink does', async () => {
    // The sink stores a note…
    const sinkDir = join(root, 'sink');
    const { receipt } = await createStore(sinkDir, { gitignore: DEFAULT_GITIGNORE }).save(
      {
        schema: 1,
        status: 'open',
        created: '2026-10-09T18:42:11.204Z',
        type: 'bug',
        body: 'Café total is wrong',
        screenshot: 'screenshot.png',
      },
      new Map([['screenshot.png', png]]),
    );
    const stored = parseNote(await readFile(join(sinkDir, receipt.dir, 'note.md'), 'utf8'));
    if (!stored.ok) throw stored.error;
    // …the same note comes back through an export zip…
    const zip = writeBundle([{ note: stored.value, attachments: { 'screenshot.png': png } }]);
    const importDir = join(root, 'imported');
    const result = await importBundle(importDir, zip);
    // …and lands the same, file for file and byte for byte.
    expect(result).toEqual({
      ok: true,
      value: { imported: [receipt.dir], skipped: [], conflicts: [] },
    });
    expect(await tree(importDir)).toEqual(await tree(sinkDir));
  });

  it('changes nothing when the same zip is imported again', async () => {
    const zip = writeBundle([
      { note: note('01JA8X3Q7K2M9V5T0N4R6P8W1Y', 'one'), attachments: { 'a.png': png } },
      { note: note('01JA8X3Q7K2M9V5T0N4R6P8W1Z', 'two'), attachments: {} },
    ]);
    const dir = join(root, '.field-notes');
    await importBundle(dir, zip);
    const before = await tree(dir);
    expect(await importBundle(dir, zip)).toEqual({
      ok: true,
      value: {
        imported: [],
        skipped: ['01JA8X3Q7K2M9V5T0N4R6P8W1Y', '01JA8X3Q7K2M9V5T0N4R6P8W1Z'],
        conflicts: [],
      },
    });
    expect(await tree(dir)).toEqual(before);
  });

  it('skips an id it already has, whatever directory holds it', async () => {
    const dir = join(root, '.field-notes');
    await importBundle(dir, writeBundle([{ note: note('n1', 'first text'), attachments: {} }]));
    const result = await importBundle(
      dir,
      writeBundle([{ note: note('n1', 'edited text, so another slug'), attachments: {} }]),
    );
    expect(result.ok && result.value).toEqual({ imported: [], skipped: ['n1'], conflicts: [] });
    expect(await readdir(join(dir, 'items'))).toEqual(['n1-first-text']);
  });

  it('reports a note whose directory is taken by another note, and leaves that one alone', async () => {
    const dir = join(root, '.field-notes');
    // `a.b` and `a_b` share a directory name: ids map `.` to `_`.
    await importBundle(dir, writeBundle([{ note: note('a.b', 'same'), attachments: {} }]));
    const before = await tree(dir);
    const result = await importBundle(
      dir,
      writeBundle([
        { note: note('a_b', 'same'), attachments: {} },
        { note: note('c', 'fine'), attachments: {} },
      ]),
    );
    expect(result.ok && result.value).toEqual({
      imported: ['items/c-fine'],
      skipped: [],
      conflicts: [{ id: 'a_b', dir: 'items/a_b-same' }],
    });
    const after = await tree(dir);
    expect(after['items/a_b-same/note.md']).toBe(before['items/a_b-same/note.md']);
  });

  it('writes nothing, not even the directory, for a zip it rejects', async () => {
    const dir = join(root, '.field-notes');
    const result = await importBundle(dir, new TextEncoder().encode('not a zip'));
    expect(result.ok ? undefined : result.error.code).toBe('not-a-zip');
    await expect(readdir(dir)).rejects.toThrow(/ENOENT/);
  });

  it('only counts finished, valid notes as already there', async () => {
    const dir = join(root, '.field-notes');
    // Being written (no note.md yet), and not a note at all.
    await mkdir(join(dir, 'items', 'x-busy'), { recursive: true });
    await mkdir(join(dir, 'items', 'y-junk'));
    await writeFile(join(dir, 'items', 'y-junk', 'note.md'), 'not a note');
    await writeFile(join(dir, 'items', 'stray-file'), serializeNote(note('z', 'stray')));
    const result = await importBundle(
      dir,
      writeBundle([
        { note: note('x', 'busy'), attachments: {} },
        { note: note('z', 'stray'), attachments: {} },
      ]),
    );
    // `x-busy` is taken, so `x` is a conflict, not "already there".
    expect(result.ok && result.value).toEqual({
      imported: ['items/z-stray'],
      skipped: [],
      conflicts: [{ id: 'x', dir: 'items/x-busy' }],
    });
  });

  it('keeps an existing .gitignore, and writes the default where there is none', async () => {
    const zip = writeBundle([{ note: note('g', 'kept'), attachments: {} }]);
    const fresh = join(root, 'fresh');
    await importBundle(fresh, zip);
    expect(await readFile(join(fresh, '.gitignore'), 'utf8')).toBe(DEFAULT_GITIGNORE);
    const edited = join(root, 'edited');
    await mkdir(edited);
    await writeFile(join(edited, '.gitignore'), '.token\n');
    await importBundle(edited, zip);
    expect(await readFile(join(edited, '.gitignore'), 'utf8')).toBe('.token\n');
  });
});
