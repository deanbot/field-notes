import * as z from 'zod/mini';

/** Version of the on-disk note format. Bumped only for breaking changes. */
export const SCHEMA_VERSION = 1;

/** Lifecycle states a note can be in. The only closed set in the format. */
export const NOTE_STATUSES = ['open', 'resolved', 'wontfix'] as const;
export type NoteStatus = (typeof NOTE_STATUSES)[number];

// Interfaces are written out because `isolatedDeclarations` can't emit types
// inferred from a schema. `_Same` below keeps them identical to the schema.

/** Bounding box in CSS pixels, relative to the viewport. */
export interface NoteRect {
  x: number;
  y: number;
  w: number;
  h: number;
  [key: string]: unknown;
}

export interface NoteViewport {
  width: number;
  height: number;
  dpr?: number | undefined;
  [key: string]: unknown;
}

/** The page element a note points at. */
export interface NoteElement {
  selector: string;
  text?: string | undefined;
  tag?: string | undefined;
  ariaLabel?: string | undefined;
  rect?: NoteRect | undefined;
  [key: string]: unknown;
}

/** Everything in a note's YAML frontmatter. Unknown fields are kept. */
export interface NoteFrontmatter {
  id: string;
  schema: typeof SCHEMA_VERSION;
  status: NoteStatus;
  created: string;
  type?: string | undefined;
  author?: string | undefined;
  environment?: string | undefined;
  url?: string | undefined;
  route?: string | undefined;
  title?: string | undefined;
  referrer?: string | undefined;
  userAgent?: string | undefined;
  colorScheme?: string | undefined;
  timezone?: string | undefined;
  viewport?: NoteViewport | undefined;
  element?: NoteElement | null | undefined;
  selection?: string | null | undefined;
  screenshot?: string | null | undefined;
  consoleErrors?: string[] | undefined;
  context?: Record<string, unknown> | undefined;
  tags?: string[] | undefined;
  resolution?: string | null | undefined;
  [key: string]: unknown;
}

/** A complete note: frontmatter fields plus the markdown body. */
export interface Note extends NoteFrontmatter {
  body: string;
}

const nonEmpty = z.string().check(z.minLength(1));

/**
 * Allowed attachment file names: ASCII letters, digits, `.`, `_` and `-`, not
 * starting with a dot, at most 128 characters. An allowlist, so a name can't be
 * a path on any OS (`C:evil.png`, `a\\b`) or hide control characters.
 */
const ATTACHMENT_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/;

/** Whether `name` is an allowed attachment file name (see spec/SPEC.md). */
export function isAttachmentName(name: string): boolean {
  return ATTACHMENT_NAME.test(name);
}

const attachmentName = z.string().check(z.regex(ATTACHMENT_NAME));

const rect = z.looseObject({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });

const viewport = z.looseObject({
  width: z.number(),
  height: z.number(),
  dpr: z.optional(z.number()),
});

const element = z.looseObject({
  selector: z.string(),
  text: z.optional(z.string()),
  tag: z.optional(z.string()),
  ariaLabel: z.optional(z.string()),
  rect: z.optional(rect),
});

const frontmatterShape = {
  id: nonEmpty,
  schema: z.literal(SCHEMA_VERSION),
  status: z.enum(NOTE_STATUSES),
  created: z.iso.datetime({ offset: true }),
  type: z.optional(nonEmpty),
  author: z.optional(z.string()),
  environment: z.optional(z.string()),
  url: z.optional(z.string()),
  route: z.optional(z.string()),
  title: z.optional(z.string()),
  referrer: z.optional(z.string()),
  userAgent: z.optional(z.string()),
  colorScheme: z.optional(z.string()),
  timezone: z.optional(z.string()),
  viewport: z.optional(viewport),
  element: z.optional(z.nullable(element)),
  selection: z.optional(z.nullable(z.string())),
  screenshot: z.optional(z.nullable(attachmentName)),
  consoleErrors: z.optional(z.array(z.string())),
  context: z.optional(z.record(z.string(), z.unknown())),
  tags: z.optional(z.array(z.string())),
  resolution: z.optional(z.nullable(z.string())),
};

const frontmatter = z.looseObject(frontmatterShape);
const note = z.looseObject({ ...frontmatterShape, body: z.string() });

/* eslint-disable @typescript-eslint/no-unnecessary-type-parameters -- type-equality idiom */
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
/* eslint-enable @typescript-eslint/no-unnecessary-type-parameters */
type _Same = [
  Equals<z.output<typeof frontmatter>, NoteFrontmatter>,
  Equals<z.output<typeof note>, Note>,
] extends [true, true]
  ? true
  : never;
const _same: _Same = true;

/** Validates a note's frontmatter (no `body`). */
export const NoteFrontmatterSchema: z.ZodMiniType<NoteFrontmatter> = frontmatter;

/**
 * Validates a complete note: frontmatter fields plus `body`. This is also the
 * JSON payload the sink accepts.
 */
export const NoteSchema: z.ZodMiniType<Note> = note;

/** JSON Schema for {@link NoteSchema}, published as `spec/note.schema.json`. */
export function noteJsonSchema(): Record<string, unknown> {
  const { $schema, ...rest } = z.toJSONSchema(note, { target: 'draft-2020-12' });
  return {
    $schema,
    $id: 'https://raw.githubusercontent.com/deanbot/field-notes/main/spec/note.schema.json',
    title: 'field-notes note',
    description: `A field-notes note (schema ${String(SCHEMA_VERSION)}): frontmatter fields plus the markdown body. See spec/SPEC.md.`,
    ...rest,
  };
}
