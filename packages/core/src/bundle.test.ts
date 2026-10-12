import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Zippable } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readBundle, serializeNote, writeBundle } from './index.ts';
import type { BundleItem, BundleResult, Note } from './index.ts';

const note = (id: string, body: string, extra: Partial<Note> = {}): Note => ({
  id,
  schema: 1,
  status: 'open',
  created: '2026-10-09T18:42:11.204Z',
  body,
  ...extra,
});

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 255]);

const items: BundleItem[] = [
  {
    note: note('01JA8X3Q7K2M9V5T0N4R6P8W1Y', 'Checkout button misaligned\n', {
      type: 'bug',
      route: '/checkout',
      screenshot: 'screenshot.png',
      custom: { kept: true },
    }),
    attachments: { 'screenshot.png': png },
  },
  {
    note: note('01JA8X3Q7K2M9V5T0N4R6P8W1Z', 'Café — idea 🚀', { url: 'http://x/' }),
    attachments: {},
  },
];

const exportedAt = new Date('2026-10-11T12:00:00.000Z');

function error(result: BundleResult): { code: string; entry: string | undefined } | undefined {
  return result.ok ? undefined : { code: result.error.code, entry: result.error.entry };
}

/** A valid item directory to put next to hostile entries. */
const validItem = (): Zippable => ({
  'items/a-note/note.md': strToU8(serializeNote(note('a', 'ok'))),
});

describe('writeBundle / readBundle', () => {
  it('round-trips notes and attachments', () => {
    const result = readBundle(writeBundle(items, { exportedAt }));
    expect(result).toEqual({ ok: true, value: items });
  });

  it('round-trips an empty bundle', () => {
    expect(readBundle(writeBundle([]))).toEqual({ ok: true, value: [] });
  });

  it('uses the .field-notes layout plus index.md', () => {
    const files = Object.keys(unzipSync(writeBundle(items, { exportedAt })));
    expect(files.sort()).toEqual([
      'index.md',
      'items/01JA8X3Q7K2M9V5T0N4R6P8W1Y-checkout-button-misaligned/note.md',
      'items/01JA8X3Q7K2M9V5T0N4R6P8W1Y-checkout-button-misaligned/screenshot.png',
      'items/01JA8X3Q7K2M9V5T0N4R6P8W1Z-cafe-idea/note.md',
    ]);
  });

  it('writes a readable index.md that links to each note', () => {
    const index = strFromU8(
      unzipSync(writeBundle(items, { exportedAt }))['index.md'] ?? new Uint8Array(),
    );
    expect(index).toBe(
      [
        '# Field notes',
        '',
        '2 notes, exported 2026-10-11T12:00:00.000Z.',
        '',
        '| Note | Type | Status | Page | Created |',
        '| --- | --- | --- | --- | --- |',
        '| [Checkout button misaligned](items/01JA8X3Q7K2M9V5T0N4R6P8W1Y-checkout-button-misaligned/note.md) | bug | open | /checkout | 2026-10-09T18:42:11.204Z |',
        '| [Café — idea 🚀](items/01JA8X3Q7K2M9V5T0N4R6P8W1Z-cafe-idea/note.md) |  | open | http://x/ | 2026-10-09T18:42:11.204Z |',
        '',
      ].join('\n'),
    );
  });

  it('escapes note text in index.md', () => {
    const hostile = note('h', '| <img src=x onerror=alert(1)> [link](javascript:x) *bold*', {
      route: 'a|b',
    });
    const zip = unzipSync(writeBundle([{ note: hostile, attachments: {} }], { exportedAt }));
    const row = strFromU8(zip['index.md'] ?? new Uint8Array()).split('\n')[6] ?? '';
    expect(row).not.toContain('<img');
    expect(row).toContain('&lt;img');
    expect(row).toContain('\\[link\\]');
    expect(row).toContain('a\\|b');
    expect(row.split(/(?<!\\)\|/)).toHaveLength(7);
  });

  it('truncates long summaries by whole characters', () => {
    const long = note('l', `${'a'.repeat(79)}🚀🚀 tail`);
    const zip = unzipSync(writeBundle([{ note: long, attachments: {} }], { exportedAt }));
    const index = strFromU8(zip['index.md'] ?? new Uint8Array());
    expect(index).toContain(`[${'a'.repeat(79)}🚀](`);
    expect(index).not.toContain('\uFFFD');
  });

  it('describes a single note and an empty export', () => {
    const one = unzipSync(writeBundle(items.slice(0, 1), { exportedAt }));
    expect(strFromU8(one['index.md'] ?? new Uint8Array())).toContain('1 note, exported');
    const none = unzipSync(writeBundle([], { exportedAt }));
    expect(strFromU8(none['index.md'] ?? new Uint8Array())).toBe(
      '# Field notes\n\n0 notes, exported 2026-10-11T12:00:00.000Z.\n',
    );
  });

  it.each([
    [
      'an invalid note',
      [{ note: { ...note('a', ''), status: 'done' } as unknown as Note, attachments: {} }],
    ],
    ['duplicate notes', [items[1], items[1]] as BundleItem[]],
    ['an attachment path', [{ note: note('a', ''), attachments: { '../x.png': png } }]],
    [
      'a drive-relative attachment name',
      [{ note: note('a', ''), attachments: { 'C:x.png': png } }],
    ],
    [
      'ids that differ only in case',
      [
        { note: note('abc', 'same'), attachments: {} },
        { note: note('ABC', 'same'), attachments: {} },
      ],
    ],
    ['an attachment named note.md', [{ note: note('a', ''), attachments: { 'note.md': png } }]],
  ])('throws on %s', (_, input) => {
    expect(() => writeBundle(input)).toThrow(TypeError);
  });
});

describe('readBundle rejects hostile input', () => {
  it.each([
    ['an absolute path', '/etc/passwd'],
    ['a parent segment', 'items/../../evil.sh'],
    ['a leading parent segment', '../evil.sh'],
    ['a current-dir segment', 'items/./a/note.md'],
    ['a backslash', 'items\\..\\evil'],
    ['a drive letter', 'C:/Windows/evil'],
    ['an empty segment', 'items//note.md'],
    ['a NUL byte', 'items/a\0/note.md'],
  ])('%s', (_, path) => {
    const zip = zipSync({ ...validItem(), [path]: strToU8('x') });
    expect(error(readBundle(zip))).toEqual({ code: 'unsafe-path', entry: path });
  });

  it.each(['C:evil.png', 'a:b', ' ', 'x\n.png', 'é.png'])('attachment name %j', (name) => {
    const zip = zipSync({ ...validItem(), [`items/a-note/${name}`]: png });
    expect(error(readBundle(zip))).toEqual({ code: 'unsafe-path', entry: `items/a-note/${name}` });
  });

  it('a symlink entry', () => {
    const zip = zipSync({
      ...validItem(),
      'items/a-note/link.png': [strToU8('/etc/passwd'), { os: 3, attrs: (0o120777 << 16) >>> 0 }],
    });
    expect(error(readBundle(zip))).toEqual({ code: 'symlink', entry: 'items/a-note/link.png' });
  });

  it.each([
    ['macOS (made-by 19)', 19],
    ['DOS with mode bits set', 0],
  ])('a symlink entry from %s', (_, os) => {
    const zip = zipSync({
      ...validItem(),
      'items/a-note/link.png': [strToU8('/etc/passwd'), { os, attrs: (0o120777 << 16) >>> 0 }],
    });
    expect(error(readBundle(zip))).toEqual({ code: 'symlink', entry: 'items/a-note/link.png' });
  });

  it('allows regular unix files', () => {
    const zip = zipSync({
      'items/a-note/note.md': [
        strToU8(serializeNote(note('a', 'ok'))),
        { os: 3, attrs: (0o100644 << 16) >>> 0 },
      ],
    });
    expect(readBundle(zip).ok).toBe(true);
  });

  it('an entry over the size limit', () => {
    const zip = zipSync({ ...validItem(), 'items/a-note/big.png': new Uint8Array(2000) });
    expect(error(readBundle(zip, { maxEntrySize: 1000 }))).toEqual({
      code: 'too-large',
      entry: 'items/a-note/big.png',
    });
  });

  it('a bundle over the total size limit', () => {
    const zip = zipSync({
      ...validItem(),
      'items/a-note/1.png': new Uint8Array(600),
      'items/a-note/2.png': new Uint8Array(600),
    });
    expect(error(readBundle(zip, { maxTotalSize: 1000 }))?.code).toBe('too-large');
  });

  it('too many entries', () => {
    const files: Zippable = validItem();
    for (let i = 0; i < 5; i++) files[`items/a-note/${String(i)}.png`] = png;
    expect(error(readBundle(zipSync(files), { maxEntries: 3 }))?.code).toBe('too-many-entries');
  });

  it('a header that understates the size of a compression bomb', () => {
    const zip = zipSync({ ...validItem(), 'items/a-note/bomb.png': new Uint8Array(1_000_000) });
    const lied = setDeclaredSize(zip, 'items/a-note/bomb.png', 100);
    expect(error(readBundle(lied))).toEqual({ code: 'corrupt', entry: 'items/a-note/bomb.png' });
  });

  it('a header that overstates the size', () => {
    const zip = zipSync({ ...validItem(), 'items/a-note/x.png': png });
    const lied = setDeclaredSize(zip, 'items/a-note/x.png', png.length + 5);
    expect(error(readBundle(lied))?.code).toBe('corrupt');
  });

  it('corrupted data', () => {
    const zip = zipSync({ ...validItem(), 'items/a-note/x.txt': strToU8('hello '.repeat(100)) });
    const name = strToU8('items/a-note/x.txt');
    const at = indexOf(zip, name) + name.length;
    zip.fill(0xff, at, at + 20);
    expect(error(readBundle(zip))?.code).toBe('corrupt');
  });

  it('duplicate entries', () => {
    const zip = zipSync({ ...validItem(), 'items/a-note/x.png': png, 'items/a-note/y.png': png });
    const renamed = replaceAll(zip, strToU8('items/a-note/y.png'), strToU8('items/a-note/x.png'));
    expect(error(readBundle(renamed))?.code).toBe('duplicate-entry');
  });

  it('a note that fails validation', () => {
    const zip = zipSync({ 'items/a-note/note.md': strToU8('---\nid: a\n---\n') });
    expect(error(readBundle(zip))).toEqual({ code: 'invalid-note', entry: 'items/a-note/note.md' });
  });

  it('an item without note.md', () => {
    const zip = zipSync({ ...validItem(), 'items/orphan/screenshot.png': png });
    expect(error(readBundle(zip))).toEqual({ code: 'invalid-note', entry: 'items/orphan/' });
  });

  it('a zip with no notes and no index.md', () => {
    expect(error(readBundle(zipSync({ 'README.txt': strToU8('hi') })))?.code).toBe('no-notes');
    expect(error(readBundle(zipSync({})))?.code).toBe('no-notes');
  });

  it('an export re-zipped under a top-level folder', () => {
    const nested: Zippable = {};
    for (const [path, bytes] of Object.entries(unzipSync(writeBundle(items)))) {
      nested[`field-notes-2026-10-11-1200/${path}`] = bytes;
    }
    expect(error(readBundle(zipSync(nested)))?.code).toBe('no-notes');
  });

  it.each([
    ['empty input', new Uint8Array()],
    ['random bytes', Uint8Array.from({ length: 512 }, (_, i) => (i * 7919) % 256)],
    ['a truncated zip', writeBundle(items).subarray(0, 100)],
  ])('%s', (_, bytes) => {
    expect(error(readBundle(bytes))?.code).toBe('not-a-zip');
  });

  it('a truncated central directory', () => {
    const zip = writeBundle(items);
    const eocd = zip.length - 22;
    new DataView(zip.buffer).setUint32(eocd + 16, eocd - 10, true);
    expect(error(readBundle(zip))?.code).toBe('corrupt');
  });

  it('zip64 markers', () => {
    const zip = writeBundle(items);
    new DataView(zip.buffer).setUint16(zip.length - 22 + 10, 0xffff, true);
    expect(error(readBundle(zip))?.code).toBe('unsupported');
  });

  it('an unknown compression method', () => {
    const zip = zipSync({ ...validItem(), 'items/a-note/x.png': png });
    setCentralField(zip, 'items/a-note/x.png', 10, 2, 99);
    expect(error(readBundle(zip))?.code).toBe('unsupported');
  });

  it('a non-UTF-8 entry name', () => {
    const zip = zipSync({ ...validItem(), 'items/a-note/x.png': png });
    const bad = replaceAll(zip, strToU8('x.png'), new Uint8Array([0xff, 0xfe, 0x2e, 0x70, 0x67]));
    expect(error(readBundle(bad))?.code).toBe('unsafe-path');
  });

  it('never throws on mutated bundles', () => {
    const zip = writeBundle(items, { exportedAt });
    for (let at = 0; at < zip.length; at += 7) {
      const mutated = zip.slice();
      mutated[at] = (mutated[at] ?? 0) ^ 0xa5;
      expect(() => readBundle(mutated)).not.toThrow();
    }
  });
});

describe('readBundle tolerates', () => {
  it('attachment names that are Object.prototype keys', () => {
    const zip = zipSync({
      ...validItem(),
      'items/a-note/__proto__': png,
      'items/a-note/constructor': png,
    });
    const result = readBundle(zip);
    const attachments = result.ok ? result.value[0]?.attachments : undefined;
    expect(attachments && Object.getPrototypeOf(attachments)).toBe(Object.prototype);
    expect(attachments && Object.keys(attachments).sort()).toEqual(['__proto__', 'constructor']);
  });

  it('unknown files, directory entries and macOS metadata', () => {
    const zip = zipSync({
      ...validItem(),
      'README.txt': strToU8('hi'),
      'items/': new Uint8Array(),
      'items/a-note/.DS_Store': png,
      '__MACOSX/items/a-note/._note.md': png,
      'items/a-note/nested/deeper.png': png,
    });
    const result = readBundle(zip);
    expect(result.ok && result.value).toEqual([{ note: note('a', 'ok'), attachments: {} }]);
  });
});

// Helpers for building malformed zips.

function indexOf(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

function replaceAll(bytes: Uint8Array, from: Uint8Array, to: Uint8Array): Uint8Array {
  const out = bytes.slice();
  for (let at = indexOf(out, from); at >= 0; at = indexOf(out, from, at + 1)) out.set(to, at);
  return out;
}

/** Writes a little-endian field in the central directory record for `name`. */
function setCentralField(
  zip: Uint8Array,
  name: string,
  offset: number,
  size: 2 | 4,
  value: number,
): void {
  const view = new DataView(zip.buffer, zip.byteOffset);
  const encoded = strToU8(name);
  for (let at = indexOf(zip, encoded); at >= 0; at = indexOf(zip, encoded, at + 1)) {
    const record = at - 46;
    if (record >= 0 && view.getUint32(record, true) === 0x02014b50) {
      if (size === 2) view.setUint16(record + offset, value, true);
      else view.setUint32(record + offset, value, true);
      return;
    }
  }
  throw new Error(`no central record for ${name}`);
}

function setDeclaredSize(zip: Uint8Array, name: string, size: number): Uint8Array {
  const copy = zip.slice();
  setCentralField(copy, name, 24, 4, size);
  return copy;
}
