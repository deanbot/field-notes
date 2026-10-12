// Building a note from the form and the page. Part of the panel chunk.
import { ulid } from '@field-notes/core/id';
import { type Note, NoteSchema, SCHEMA_VERSION } from '@field-notes/core/note';

/** Longest `selection` kept, in characters. */
export const MAX_SELECTION = 2000;

/** How long a submit waits for a still-pending `context()` before going without it. */
const CONTEXT_TIMEOUT_MS = 1000;

const warn = (message: string, error?: unknown): void => {
  if (error === undefined) console.warn(`[field-notes] ${message}`);
  else console.warn(`[field-notes] ${message}`, error);
};

/** What the page says about itself at submit time. */
function pageMetadata(): Pick<
  Note,
  'url' | 'route' | 'title' | 'referrer' | 'userAgent' | 'colorScheme' | 'timezone' | 'viewport'
> {
  return {
    url: location.href,
    route: location.pathname,
    title: document.title,
    ...(document.referrer ? { referrer: document.referrer } : {}),
    userAgent: navigator.userAgent,
    colorScheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
  };
}

/**
 * Keeps a `context()` result only if it's plain data: an object (not an
 * array) that survives a JSON round trip. Anything else is dropped with a
 * warning, since it couldn't be written to the note.
 */
export function toContext(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    warn('context() must return a plain object; leaving it out.');
    return undefined;
  }
  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  } catch (error) {
    warn("context() returned something that isn't plain data; leaving it out.", error);
    return undefined;
  }
}

/**
 * Calls the host's `context()` now and settles with its plain-data result, or
 * with undefined if it throws or rejects. Never rejects, and has no deadline:
 * `awaitContext()` applies that when the note is submitted.
 */
export function startContext(
  context: (() => unknown) | undefined,
): Promise<Record<string, unknown> | undefined> {
  if (!context) return Promise.resolve(undefined);
  try {
    return Promise.resolve(context()).then(toContext, (error: unknown) => {
      warn('context() rejected; leaving it out.', error);
      return undefined;
    });
  } catch (error) {
    warn('context() threw; leaving it out.', error);
    return Promise.resolve(undefined);
  }
}

/**
 * Waits for a started `context()` at submit time, for at most `timeoutMs`
 * more, then goes without it. Aborting `signal` (unmount) settles it at once
 * and clears the timer. Never rejects.
 */
export function awaitContext(
  pending: Promise<Record<string, unknown> | undefined>,
  signal: AbortSignal,
  timeoutMs: number = CONTEXT_TIMEOUT_MS,
): Promise<Record<string, unknown> | undefined> {
  return new Promise((resolve) => {
    const done = (value: Record<string, unknown> | undefined): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(value);
    };
    const onAbort = (): void => {
      done(undefined);
    };
    const timer = setTimeout(() => {
      warn(`context() hadn't settled ${String(timeoutMs)} ms after submit; leaving it out.`);
      done(undefined);
    }, timeoutMs);
    if (signal.aborted) {
      done(undefined);
      return;
    }
    signal.addEventListener('abort', onAbort);
    void pending.then(done);
  });
}

/** The host's `author`, or undefined if it isn't set or its function throws. */
export function resolveAuthor(author: string | (() => string) | undefined): string | undefined {
  if (typeof author !== 'function') return author;
  try {
    const value: unknown = author();
    return typeof value === 'string' ? value : undefined;
  } catch (error) {
    warn('author() threw; leaving it out.', error);
    return undefined;
  }
}

export interface NoteInput {
  readonly body: string;
  readonly type?: string | undefined;
  readonly author?: string | undefined;
  readonly environment: string;
  readonly selection?: string | undefined;
  readonly context?: Record<string, unknown> | undefined;
  readonly consoleErrors?: readonly string[] | undefined;
  readonly now?: Date | undefined;
}

/**
 * A complete note, validated against the core schema. The id is minted here:
 * the outbox and export mode key notes by it, and the local sink assigns its
 * own (#12).
 */
export function buildNote(input: NoteInput): Note {
  const now = input.now ?? new Date();
  const note: Note = {
    id: ulid(now.getTime()),
    schema: SCHEMA_VERSION,
    status: 'open',
    created: now.toISOString(),
    ...(input.type ? { type: input.type } : {}),
    ...(input.author ? { author: input.author } : {}),
    environment: input.environment,
    ...pageMetadata(),
    ...(input.selection ? { selection: input.selection.slice(0, MAX_SELECTION) } : {}),
    ...(input.consoleErrors?.length ? { consoleErrors: [...input.consoleErrors] } : {}),
    ...(input.context ? { context: input.context } : {}),
    body: input.body,
  };
  return NoteSchema.parse(note);
}
