import { Scalar, parse, parseDocument, stringify, visit } from 'yaml';
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

// Written with YAML 1.1 rules so strings that 1.1 parsers (PyYAML and others)
// would read as dates, booleans or numbers get quoted. The output is still YAML 1.2.
const YAML_OPTIONS = { lineWidth: 0, schema: 'yaml-1.1' } as const;
// Warnings (unknown tags and the like) aren't errors; don't print them in someone's console.
const PARSE_OPTIONS = { uniqueKeys: true, logLevel: 'error' } as const;

/** Renders a note as `note.md`: YAML frontmatter, a blank line, then the body verbatim. */
export function serializeNote(note: Note): string {
  const { body, ...fields } = note;
  const known = new Set<string>(FIELD_ORDER);
  // Own keys only, and Object.fromEntries rather than assignment, so unknown
  // fields named `toString` or `__proto__` are written like any other.
  const ordered = Object.fromEntries([
    ...FIELD_ORDER.filter((key) => Object.hasOwn(fields, key)).map((key): [string, unknown] => [
      key,
      fields[key],
    ]),
    ...Object.entries(fields).filter(([key]) => !known.has(key)),
  ]);
  return `---\n${stringify(ordered, YAML_OPTIONS)}---\n\n${body}`;
}

interface Parts {
  /** The opening `---` line as written, including any BOM. */
  opening: string;
  frontmatter: string;
  /** The closing `---` line as written, without the newline before it. */
  closing: string;
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
    opening: opening[0],
    frontmatter: afterOpening.slice(0, closing.index),
    closing: closing[0].replace(/^\r?\n/, ''),
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
    if (patch[key] === undefined) continue;
    // The document keeps its own (1.2) schema, so quote ambiguous strings explicitly.
    const node = doc.createNode(patch[key]);
    visit(node, {
      Scalar(_, scalar) {
        if (typeof scalar.value === 'string' && readsAsOtherType(scalar.value)) {
          scalar.type = Scalar.QUOTE_DOUBLE;
        }
      },
    });
    doc.set(key, node);
  }
  const checked = validate(doc.toJS(), parts.rest.replace(/^\r?\n/, ''));
  if (!checked.ok) return checked;
  const eol = parts.opening.endsWith('\r\n') ? '\r\n' : '\n';
  const frontmatter = doc.toString({ lineWidth: 0 }).replace(/\n/g, eol);
  return { ok: true, value: `${parts.opening}${frontmatter}${parts.closing}${parts.rest}` };
}

/** Whether a YAML 1.1 parser would read `text`, unquoted, as something other than this string. */
function readsAsOtherType(text: string): boolean {
  try {
    return parse(text, { schema: 'yaml-1.1', logLevel: 'error' }) !== text;
  } catch {
    return true;
  }
}

/** The body's last level-2 heading, ignoring lines inside fenced code blocks. */
function lastHeading(body: string): string | undefined {
  let fence: string | undefined;
  let last: string | undefined;
  for (const line of body.split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && !fence) fence = marker;
    else if (marker && fence && marker.startsWith(fence.charAt(0)) && marker.length >= fence.length)
      fence = undefined;
    else if (!fence && line.startsWith('## ')) last = line.trim();
  }
  return last;
}

/**
 * Appends a paragraph to the `## Notes` section at the end of the body,
 * starting that section if the body's last heading isn't already `## Notes`.
 * Uses the file's own line endings.
 */
export function appendToNotes(text: string, entry: string): NoteResult<string> {
  const parsed = parseNote(text);
  if (!parsed.ok) return parsed;
  const parts = split(text);
  /* v8 ignore next -- parseNote already split it */
  if (!parts) return { ok: false, error: missingFrontmatter() };
  const head = text.slice(0, text.length - parts.rest.length);
  const body = parts.rest.replace(/\s+$/, '');
  const eol = parts.opening.endsWith('\r\n') ? '\r\n' : '\n';
  const section =
    lastHeading(body) === '## Notes' ? '' : `${body.trim() ? eol + eol : eol}## Notes`;
  const paragraph = entry.trim().replace(/\r?\n/g, eol);
  return { ok: true, value: `${head}${body}${section}${eol}${eol}${paragraph}${eol}` };
}

/**
 * Directory name for a note: `<id>-<slug>`, where the slug comes from the
 * body's first non-empty line. Safe as a single path segment whatever the input.
 * Not unique: different ids can map to the same name, so writers must create
 * the directory exclusively (see spec/SPEC.md).
 */
export function noteDirName(note: Pick<Note, 'id' | 'body'>): string {
  const safeId = note.id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  const firstLine = note.body.split('\n').find((line) => line.trim()) ?? '';
  return `${safeId}-${slugify(firstLine)}`;
}
