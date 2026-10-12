import { parse, parseDocument, stringify } from 'yaml';
import { NoteSchema } from './note.ts';
import type { Note, NoteFrontmatter } from './note.ts';
import { slugify } from './slug.ts';

export type NoteParseErrorCode = 'missing-frontmatter' | 'invalid-yaml' | 'invalid-note';

/** Why a `note.md` couldn't be read. Returned, never thrown, by the readers below. */
export class NoteParseError extends Error {
  override readonly name = 'NoteParseError';
  readonly code: NoteParseErrorCode;
  /** Schema problems, for `invalid-note`. */
  readonly issues: readonly { path: string; message: string }[];

  constructor(
    code: NoteParseErrorCode,
    message: string,
    issues: readonly { path: string; message: string }[] = [],
  ) {
    super(message);
    this.code = code;
    this.issues = issues;
  }
}

export type NoteResult<T> = { ok: true; value: T } | { ok: false; error: NoteParseError };

/** The only frontmatter fields a reader may change (see spec/SPEC.md). */
export type NotePatch = Partial<Pick<NoteFrontmatter, 'status' | 'resolution' | 'tags'>>;

/** Frontmatter order on disk: the spec's field order, then any unknown fields. */
const FIELD_ORDER = [
  'id',
  'schema',
  'status',
  'type',
  'author',
  'created',
  'environment',
  'url',
  'route',
  'title',
  'referrer',
  'userAgent',
  'colorScheme',
  'timezone',
  'viewport',
  'element',
  'selection',
  'screenshot',
  'consoleErrors',
  'context',
  'tags',
  'resolution',
] as const;

const YAML_OPTIONS = { lineWidth: 0 } as const;
// Warnings (unknown tags and the like) aren't errors; don't print them in someone's console.
const PARSE_OPTIONS = { uniqueKeys: true, logLevel: 'error' } as const;

/** Renders a note as `note.md`: YAML frontmatter, a blank line, then the body verbatim. */
export function serializeNote(note: Note): string {
  const { body, ...fields } = note;
  const ordered: Record<string, unknown> = {};
  for (const key of FIELD_ORDER) if (key in fields) ordered[key] = fields[key];
  for (const [key, value] of Object.entries(fields)) if (!(key in ordered)) ordered[key] = value;
  return `---\n${stringify(ordered, YAML_OPTIONS)}---\n\n${body}`;
}

interface Parts {
  frontmatter: string;
  /** Everything after the closing `---` line, untouched. */
  rest: string;
}

const OPENING = /^\uFEFF?---[ \t]*\r?\n/;
const CLOSING = /(?:^|\r?\n)---[ \t]*(?:\r?\n|$)/;

function split(text: string): Parts | undefined {
  const opening = OPENING.exec(text);
  if (!opening) return undefined;
  const afterOpening = text.slice(opening[0].length);
  const closing = CLOSING.exec(afterOpening);
  if (!closing) return undefined;
  return {
    frontmatter: afterOpening.slice(0, closing.index),
    rest: afterOpening.slice(closing.index + closing[0].length),
  };
}

const missingFrontmatter = (): NoteParseError =>
  new NoteParseError('missing-frontmatter', 'note.md must start with a --- frontmatter block');

function validate(fields: unknown, body: string): NoteResult<Note> {
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
    return {
      ok: false,
      error: new NoteParseError('invalid-note', 'Frontmatter must be a YAML mapping'),
    };
  }
  const result = NoteSchema.safeParse({ ...fields, body });
  if (result.success) return { ok: true, value: result.data };
  const issues = result.error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
  const summary = issues.map((issue) => `${issue.path || '(root)'}: ${issue.message}`).join('; ');
  return {
    ok: false,
    error: new NoteParseError('invalid-note', `Invalid note: ${summary}`, issues),
  };
}

/** Reads a `note.md`. Never throws: malformed input comes back as a {@link NoteParseError}. */
export function parseNote(text: string): NoteResult<Note> {
  const parts = split(text);
  if (!parts) return { ok: false, error: missingFrontmatter() };
  let fields: unknown;
  try {
    fields = parse(parts.frontmatter, PARSE_OPTIONS);
  } catch (error) {
    return {
      ok: false,
      error: new NoteParseError('invalid-yaml', `Invalid frontmatter: ${(error as Error).message}`),
    };
  }
  return validate(fields, parts.rest.replace(/^\r?\n/, ''));
}

/**
 * Changes only `status`, `resolution` and `tags`, keeping the rest of the file
 * (comments, field order, unknown fields, the body) as it was.
 */
export function updateNote(text: string, patch: NotePatch): NoteResult<string> {
  const parts = split(text);
  if (!parts) return { ok: false, error: missingFrontmatter() };
  const doc = parseDocument(parts.frontmatter, PARSE_OPTIONS);
  const [firstError] = doc.errors;
  if (firstError) {
    return {
      ok: false,
      error: new NoteParseError('invalid-yaml', `Invalid frontmatter: ${firstError.message}`),
    };
  }
  for (const key of ['status', 'resolution', 'tags'] as const) {
    if (key in patch) doc.set(key, patch[key]);
  }
  const checked = validate(doc.toJS(), parts.rest.replace(/^\r?\n/, ''));
  if (!checked.ok) return checked;
  return { ok: true, value: `---\n${doc.toString(YAML_OPTIONS)}---\n${parts.rest}` };
}

const HEADING = /^## .*$/gm;

/**
 * Appends a paragraph to the `## Notes` section at the end of the body,
 * starting that section if the body's last heading isn't already `## Notes`.
 */
export function appendToNotes(text: string, entry: string): NoteResult<string> {
  const parsed = parseNote(text);
  if (!parsed.ok) return parsed;
  const parts = split(text);
  /* v8 ignore next -- parseNote already split it */
  if (!parts) return { ok: false, error: missingFrontmatter() };
  const head = text.slice(0, text.length - parts.rest.length);
  const body = parts.rest.replace(/\s+$/, '');
  const lastHeading = [...body.matchAll(HEADING)].at(-1)?.[0].trim();
  const section = lastHeading === '## Notes' ? '' : `${body.trim() ? '\n\n' : '\n'}## Notes`;
  return { ok: true, value: `${head}${body}${section}\n\n${entry.trim()}\n` };
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A ULID: 48-bit millisecond timestamp plus 80 random bits, Crockford base32. */
export function ulid(now: number = Date.now()): string {
  if (!Number.isInteger(now) || now < 0 || now >= 2 ** 48) {
    throw new RangeError(`ulid: timestamp out of range: ${String(now)}`);
  }
  let time = '';
  for (let rest = now, i = 0; i < 10; i++, rest = Math.floor(rest / 32)) {
    time = CROCKFORD.charAt(rest % 32) + time;
  }
  // 256 is a multiple of 32, so masking each byte keeps the distribution uniform.
  const random = crypto.getRandomValues(new Uint8Array(16));
  return time + Array.from(random, (byte) => CROCKFORD.charAt(byte & 31)).join('');
}

/**
 * Directory name for a note: `<id>-<slug>`, where the slug comes from the
 * body's first non-empty line. Safe as a single path segment whatever the input.
 */
export function noteDirName(note: Pick<Note, 'id' | 'body'>): string {
  const safeId = note.id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  const firstLine = note.body.split('\n').find((line) => line.trim()) ?? '';
  return `${safeId}-${slugify(firstLine)}`;
}
