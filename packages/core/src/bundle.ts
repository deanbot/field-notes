import { inflateSync, zipSync } from 'fflate';
import type { Zippable } from 'fflate';
import { NoteSchema } from './note.ts';
import type { Note } from './note.ts';
import { noteDirName, parseNote, serializeNote } from './note-file.ts';

/** A note and the files stored next to it, keyed by file name. */
export interface BundleItem {
  note: Note;
  attachments: Record<string, Uint8Array>;
}

export interface WriteBundleOptions {
  /** Shown in `index.md` and used as the entries' modification time. Defaults to now. */
  exportedAt?: Date;
}

export interface ReadBundleOptions {
  /** Largest allowed uncompressed size of a single entry, in bytes. Default 64 MiB. */
  maxEntrySize?: number;
  /** Largest allowed uncompressed size of the whole bundle, in bytes. Default 256 MiB. */
  maxTotalSize?: number;
  /** Most entries allowed in the zip. Default 10,000. */
  maxEntries?: number;
}

export type BundleErrorCode =
  | 'not-a-zip'
  | 'unsupported'
  | 'corrupt'
  | 'unsafe-path'
  | 'symlink'
  | 'duplicate-entry'
  | 'too-many-entries'
  | 'too-large'
  | 'invalid-note';

/** Why a bundle was rejected. Returned, never thrown, by {@link readBundle}. */
export class BundleError extends Error {
  override readonly name = 'BundleError';
  readonly code: BundleErrorCode;
  /** The zip entry at fault, when there is one. */
  readonly entry: string | undefined;

  constructor(code: BundleErrorCode, message: string, entry?: string) {
    super(entry === undefined ? message : `${entry}: ${message}`);
    this.code = code;
    this.entry = entry;
  }
}

export type BundleResult = { ok: true; value: BundleItem[] } | { ok: false; error: BundleError };

const NOTE_FILE = 'note.md';
const SAFE_SEGMENT = /^(?!\.\.?$)[^/\\\0]+$/;

/**
 * Builds an export zip: the `.field-notes/` layout (`items/<id>-<slug>/note.md`
 * plus attachments) and a human-readable `index.md`. Throws on invalid input.
 */
export function writeBundle(
  items: readonly BundleItem[],
  options: WriteBundleOptions = {},
): Uint8Array {
  const exportedAt = options.exportedAt ?? new Date();
  const encoder = new TextEncoder();
  const files: Zippable = {};
  const rows: { dir: string; note: Note }[] = [];

  for (const { note, attachments } of items) {
    const checked = NoteSchema.safeParse(note);
    if (!checked.success) throw new TypeError(`writeBundle: invalid note ${note.id}`);
    const dir = noteDirName(note);
    const prefix = `items/${dir}/`;
    if (`${prefix}${NOTE_FILE}` in files) throw new TypeError(`writeBundle: duplicate note ${dir}`);
    files[`${prefix}${NOTE_FILE}`] = encoder.encode(serializeNote(note));
    for (const [name, bytes] of Object.entries(attachments)) {
      if (!SAFE_SEGMENT.test(name) || name === NOTE_FILE) {
        throw new TypeError(`writeBundle: invalid attachment name ${JSON.stringify(name)}`);
      }
      // Already-compressed formats (PNG, JPEG, WebP) don't shrink; store them as-is.
      files[`${prefix}${name}`] = [bytes, { level: 0 }];
    }
    rows.push({ dir, note });
  }

  files['index.md'] = encoder.encode(renderIndex(rows, exportedAt));
  return zipSync(files, { mtime: exportedAt });
}

/** Text that can't break out of a markdown table cell or inject HTML. */
function cell(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\\|[\]*_`])/g, '\\$1');
}

function renderIndex(rows: readonly { dir: string; note: Note }[], exportedAt: Date): string {
  const lines = [
    '# Field notes',
    '',
    `${String(rows.length)} ${rows.length === 1 ? 'note' : 'notes'}, exported ${exportedAt.toISOString()}.`,
    '',
  ];
  if (rows.length > 0) {
    lines.push('| Note | Type | Status | Page | Created |', '| --- | --- | --- | --- | --- |');
    for (const { dir, note } of rows) {
      const summary = note.body.split('\n').find((line) => line.trim()) ?? '(no text)';
      const page = note.route ?? note.url ?? '';
      lines.push(
        `| [${cell(summary.slice(0, 80))}](items/${dir}/${NOTE_FILE}) | ${cell(note.type ?? '')} | ${note.status} | ${cell(page)} | ${note.created} |`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

interface Entry {
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  dataOffset: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const UNIX = 3;
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

class Reject extends Error {
  readonly error: BundleError;
  constructor(code: BundleErrorCode, message: string, entry?: string) {
    super(message);
    this.error = new BundleError(code, message, entry);
  }
}

/** Reads the central directory. Rejects anything this format never produces. */
function readEntries(bytes: Uint8Array, maxEntries: number): Entry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => view.getUint16(at, true);
  const u32 = (at: number) => view.getUint32(at, true);
  const inBounds = (at: number, length: number) => at >= 0 && at + length <= bytes.length;

  let eocd = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) {
    if (u32(at) === EOCD_SIGNATURE) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) throw new Reject('not-a-zip', 'No zip end-of-central-directory record');

  const count = u16(eocd + 10);
  const directoryOffset = u32(eocd + 16);
  if (count === 0xffff || directoryOffset === 0xffffffff) {
    throw new Reject('unsupported', 'Zip64 archives are not supported');
  }
  if (count > maxEntries) {
    throw new Reject('too-many-entries', `${String(count)} entries (limit ${String(maxEntries)})`);
  }

  const decoder = new TextDecoder('utf-8', { fatal: true });
  const entries: Entry[] = [];
  let at = directoryOffset;
  for (let i = 0; i < count; i++) {
    if (!inBounds(at, 46) || u32(at) !== CENTRAL_SIGNATURE) {
      throw new Reject('corrupt', 'Malformed central directory');
    }
    const madeBy = u16(at + 4) >> 8;
    const method = u16(at + 10);
    const crc = u32(at + 16);
    const compressedSize = u32(at + 20);
    const size = u32(at + 24);
    const nameLength = u16(at + 28);
    const extraLength = u16(at + 30);
    const commentLength = u16(at + 32);
    const mode = u32(at + 38) >>> 16;
    const localOffset = u32(at + 42);
    if (!inBounds(at + 46, nameLength)) throw new Reject('corrupt', 'Malformed central directory');

    let name: string;
    try {
      name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    } catch {
      throw new Reject('unsafe-path', 'Entry name is not valid UTF-8');
    }
    if (madeBy === UNIX && (mode & S_IFMT) === S_IFLNK) {
      throw new Reject('symlink', 'Symbolic links are not allowed', name);
    }
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) {
      throw new Reject('unsupported', 'Zip64 entries are not supported', name);
    }

    if (!inBounds(localOffset, 30) || u32(localOffset) !== LOCAL_SIGNATURE) {
      throw new Reject('corrupt', 'Missing local file header', name);
    }
    const dataOffset = localOffset + 30 + u16(localOffset + 26) + u16(localOffset + 28);
    if (!inBounds(dataOffset, compressedSize))
      throw new Reject('corrupt', 'Entry data is truncated', name);

    entries.push({ name, method, crc, compressedSize, size, dataOffset });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * Allows only relative paths made of ordinary segments. A leading `/` shows up
 * as an empty first segment.
 */
function checkPath(name: string): void {
  const segments = name.replace(/\/$/, '').split('/');
  if (/^[A-Za-z]:/.test(name) || segments.some((segment) => !SAFE_SEGMENT.test(segment))) {
    throw new Reject('unsafe-path', 'Absolute, parent or malformed path', name);
  }
}

function extract(bytes: Uint8Array, entry: Entry): Uint8Array {
  const data = bytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
  let out: Uint8Array;
  if (entry.method === 0) {
    out = data.slice();
  } else if (entry.method === 8) {
    // A fixed-size output buffer means a lying header can't make us allocate more.
    try {
      out = inflateSync(data, { out: new Uint8Array(entry.size) });
    } catch {
      throw new Reject('corrupt', 'Entry data does not decompress', entry.name);
    }
  } else {
    throw new Reject('unsupported', `Compression method ${String(entry.method)}`, entry.name);
  }
  if (out.length !== entry.size || crc32(out) !== entry.crc) {
    throw new Reject('corrupt', 'Entry size or checksum mismatch', entry.name);
  }
  return out;
}

const IGNORED = /(^|\/)(__MACOSX\/|\.DS_Store$)/;

/**
 * Reads an export zip back into notes and attachments. The input is treated as
 * hostile: unsafe paths, symlinks, oversized entries and invalid notes are
 * rejected with a {@link BundleError}. Unknown files are ignored.
 */
export function readBundle(bytes: Uint8Array, options: ReadBundleOptions = {}): BundleResult {
  const {
    maxEntrySize = 64 * 2 ** 20,
    maxTotalSize = 256 * 2 ** 20,
    maxEntries = 10_000,
  } = options;
  try {
    const entries = readEntries(bytes, maxEntries);
    const seen = new Set<string>();
    let total = 0;
    for (const entry of entries) {
      checkPath(entry.name);
      if (seen.has(entry.name)) throw new Reject('duplicate-entry', 'Duplicate entry', entry.name);
      seen.add(entry.name);
      if (entry.size > maxEntrySize) {
        throw new Reject('too-large', `Entry exceeds ${String(maxEntrySize)} bytes`, entry.name);
      }
      total += entry.size;
      if (total > maxTotalSize) {
        throw new Reject('too-large', `Bundle exceeds ${String(maxTotalSize)} bytes`);
      }
    }

    // Attachment names come from the zip, so collect pairs and let Object.fromEntries
    // define them: assigning `record['__proto__']` would set the prototype instead.
    const items = new Map<string, { note?: Note; attachments: [string, Uint8Array][] }>();
    const decoder = new TextDecoder();
    for (const entry of entries) {
      const match = /^items\/([^/]+)\/([^/]+)$/.exec(entry.name);
      if (!match || IGNORED.test(entry.name)) continue;
      const [, dir = '', file = ''] = match;
      const item = items.get(dir) ?? { attachments: [] };
      items.set(dir, item);
      const content = extract(bytes, entry);
      if (file === NOTE_FILE) {
        const parsed = parseNote(decoder.decode(content));
        if (!parsed.ok) throw new Reject('invalid-note', parsed.error.message, entry.name);
        item.note = parsed.value;
      } else {
        item.attachments.push([file, content]);
      }
    }

    const result: BundleItem[] = [];
    for (const [dir, { note, attachments }] of items) {
      if (!note) throw new Reject('invalid-note', `Missing ${NOTE_FILE}`, `items/${dir}/`);
      result.push({ note, attachments: Object.fromEntries(attachments) });
    }
    return { ok: true, value: result };
  } catch (error) {
    if (error instanceof Reject) return { ok: false, error: error.error };
    throw error;
  }
}

let crcTable: Uint32Array | undefined;

function crc32(data: Uint8Array): number {
  crcTable ??= Uint32Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });
  let crc = 0xffffffff;
  for (const byte of data) crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
