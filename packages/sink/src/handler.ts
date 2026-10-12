// The sink's request handler: one function over node:http's request and
// response, wrapped by `serve`, the Vite plugin and the middleware. It
// accepts a note at `POST /__field-notes` and writes it with the store.
import { execFile } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { isAttachmentName } from '@field-notes/core';
import { DEFAULT_ALLOWED_ORIGINS, isAllowedOrigin } from './origin.ts';
import { InvalidNoteError, createStore } from './store.ts';

/** Where the sink takes notes, on its own server or mounted on a dev server. */
export const SINK_PATH = '/__field-notes';

/** The request header that carries the sink's token. */
export const TOKEN_HEADER = 'x-field-notes-token';

/** Largest request body accepted by default: 16 MiB. */
export const DEFAULT_MAX_BYTES: number = 16 * 1024 * 1024;

export interface SinkOptions {
  /** The `.field-notes` directory. Relative paths resolve against the working directory. */
  readonly dir: string;
  /** Every request must carry it in the `x-field-notes-token` header. */
  readonly token: string;
  /**
   * Origins allowed to send notes: exact origins, or `http://host:*` for any
   * port. Default: localhost and loopback.
   */
  readonly allowedOrigins?: readonly string[] | undefined;
  /** Largest request body, in bytes. Default 16 MiB. */
  readonly maxBytes?: number | undefined;
  /** Contents of `.gitignore` in `dir`, written if there's none. `false` for none. Default `*`. */
  readonly gitignore?: string | false | undefined;
  /**
   * `author` for notes that don't have one. Default: `git config user.name`
   * in the directory above `dir`. `false` for none.
   */
  readonly defaultAuthor?: string | false | undefined;
  /** Default `/__field-notes`. */
  readonly path?: string | undefined;
}

/**
 * A node:http (and Connect) request handler. Requests for other paths go to
 * `next`, or get a 404 without one.
 */
export type SinkHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  next?: (error?: unknown) => void,
) => void;

/**
 * Why a request was refused, as the `error` field of the JSON body. A client
 * can tell a note that will never be accepted (`invalid-request`,
 * `invalid-note`, `too-large`) from a refusal that a new token or config
 * could fix (`origin`, `token`).
 */
export type SinkErrorCode =
  | 'origin'
  | 'token'
  | 'method'
  | 'content-type'
  | 'too-large'
  | 'invalid-request'
  | 'invalid-note'
  | 'internal';

const STATUS: Record<SinkErrorCode, number> = {
  origin: 403,
  token: 401,
  method: 405,
  'content-type': 415,
  'too-large': 413,
  'invalid-request': 400,
  'invalid-note': 422,
  internal: 500,
};

class RequestError extends Error {
  readonly code: SinkErrorCode;
  constructor(code: SinkErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const digest = (text: string): Buffer => createHash('sha256').update(text).digest();

/** `git config user.name`, or undefined if there's no git or no name. */
function gitUserName(cwd: string): Promise<string | undefined> {
  return new Promise((done) => {
    execFile('git', ['config', 'user.name'], { cwd, timeout: 2000 }, (error, stdout) => {
      const name = error ? '' : stdout.trim();
      done(name || undefined);
    });
  });
}

/** Reads the body, or throws `too-large` as soon as it passes `max` bytes. */
function readBody(req: IncomingMessage, max: number): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const onData = (chunk: Buffer): void => {
      size += chunk.length;
      if (size > max) {
        req.off('data', onData);
        fail(new RequestError('too-large', `body is over ${String(max)} bytes`));
        return;
      }
      chunks.push(chunk);
    };
    req.on('data', onData);
    req.on('end', () => {
      // Copied into a plain ArrayBuffer, which `Response` takes as a body.
      const body = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.length;
      }
      done(body);
    });
    req.on('error', fail);
  });
}

interface Parsed {
  readonly fields: Record<string, unknown>;
  readonly attachments: Map<string, Uint8Array>;
}

/**
 * `application/json`: the payload. `multipart/form-data`: the payload as a
 * `note` field, and each attachment as a file field named after it. Field
 * names are the attachment names; the multipart `filename` is ignored.
 */
async function parseBody(type: string, body: Uint8Array<ArrayBuffer>): Promise<Parsed> {
  const attachments = new Map<string, Uint8Array>();
  let json: string;
  if (type === 'application/json') {
    json = new TextDecoder().decode(body);
  } else {
    let form: FormData;
    try {
      // Deprecated for servers because it buffers the whole body; readBody
      // already has, under the size cap.
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      form = await new Response(body, { headers: { 'content-type': type } }).formData();
    } catch {
      throw new RequestError('invalid-request', 'malformed multipart body');
    }
    const note = form.getAll('note');
    const [only] = note;
    if (note.length !== 1 || typeof only !== 'string') {
      throw new RequestError('invalid-request', 'expected one `note` field holding JSON');
    }
    json = only;
    // Compared without case: on a case-insensitive filesystem `A.png`
    // overwrites `a.png`, and `NOTE.MD` is the note itself.
    const seen = new Set(['note.md']);
    for (const [name, value] of form) {
      if (name === 'note') continue;
      if (typeof value === 'string' || !isAttachmentName(name)) {
        throw new RequestError('invalid-request', `bad attachment: ${JSON.stringify(name)}`);
      }
      if (seen.has(name.toLowerCase())) {
        throw new RequestError('invalid-request', `attachment name taken: ${name}`);
      }
      seen.add(name.toLowerCase());
      attachments.set(name, new Uint8Array(await value.arrayBuffer()));
    }
  }
  let fields: unknown;
  try {
    fields = JSON.parse(json);
  } catch {
    throw new RequestError('invalid-request', 'note is not valid JSON');
  }
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
    throw new RequestError('invalid-request', 'note must be a JSON object');
  }
  return { fields: fields as Record<string, unknown>, attachments };
}

/** Accepts notes from the widget. See {@link SinkOptions}. */
export function createSinkHandler(options: SinkOptions): SinkHandler {
  const root = resolve(options.dir);
  const path = options.path ?? SINK_PATH;
  const allowed = options.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const token = digest(options.token);
  const store = createStore(root, { gitignore: options.gitignore ?? '*\n' });
  let author: Promise<string | undefined> | undefined;
  const defaultAuthor = (): Promise<string | undefined> => {
    const configured = options.defaultAuthor;
    if (configured !== undefined) return Promise.resolve(configured || undefined);
    author ??= gitUserName(dirname(root));
    return author;
  };

  const accept = async (req: IncomingMessage): Promise<{ status: number; body: unknown }> => {
    const given = req.headers[TOKEN_HEADER];
    // Hashed first: timingSafeEqual needs equal lengths.
    if (typeof given !== 'string' || !timingSafeEqual(digest(given), token)) {
      throw new RequestError('token', `missing or wrong ${TOKEN_HEADER} header`);
    }
    const type = req.headers['content-type'] ?? '';
    const mime = type.split(';')[0]?.trim().toLowerCase();
    if (mime !== 'application/json' && mime !== 'multipart/form-data') {
      throw new RequestError('content-type', 'expected application/json or multipart/form-data');
    }
    if (Number(req.headers['content-length']) > maxBytes) {
      throw new RequestError('too-large', `body is over ${String(maxBytes)} bytes`);
    }
    const { fields, attachments } = await parseBody(
      mime === 'application/json' ? mime : type,
      await readBody(req, maxBytes),
    );
    if ('id' in fields) {
      throw new RequestError('invalid-request', 'the sink assigns `id`; send `clientId` instead');
    }
    const { clientId, ...note } = fields;
    if (clientId !== undefined && (typeof clientId !== 'string' || clientId === '')) {
      throw new RequestError('invalid-request', '`clientId` must be a non-empty string');
    }
    if (typeof note.screenshot === 'string' && !attachments.has(note.screenshot)) {
      throw new RequestError('invalid-request', '`screenshot` names a file that was not sent');
    }
    if (note.author === undefined) {
      const name = await defaultAuthor();
      if (name !== undefined) note.author = name;
    }
    const { receipt, created } = await store.save(note, attachments, clientId);
    return { status: created ? 201 : 200, body: receipt };
  };

  return (req, res, next) => {
    // URL.parse, not new URL: a malformed request line must not throw here,
    // where nothing would catch it.
    const url = URL.parse(req.url ?? '/', 'http://sink');
    if (url?.pathname !== path) {
      if (next) next();
      else reply(res, 404, { error: 'not-found', message: 'not found' });
      return;
    }
    const origin = req.headers.origin;
    if (origin === undefined || !isAllowedOrigin(origin, allowed)) {
      reply(res, STATUS.origin, { error: 'origin', message: 'origin not allowed' });
      return;
    }
    // CORS on every answer to an allowed origin, errors too, so the
    // widget can read why a note was refused.
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      // A preflight carries no token; it only asks which headers are allowed.
      res.setHeader('Access-Control-Allow-Methods', 'POST');
      res.setHeader('Access-Control-Allow-Headers', `content-type, ${TOKEN_HEADER}`);
      res.setHeader('Access-Control-Max-Age', '600');
      res.writeHead(204).end();
      return;
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST, OPTIONS');
      reply(res, STATUS.method, { error: 'method', message: 'POST a note' });
      return;
    }
    accept(req).then(
      ({ status, body }) => {
        reply(res, status, body);
      },
      (error: unknown) => {
        const code: SinkErrorCode =
          error instanceof RequestError
            ? error.code
            : error instanceof InvalidNoteError
              ? 'invalid-note'
              : 'internal';
        if (code === 'internal') console.error('field-notes sink:', error);
        const message = code === 'internal' ? 'could not store the note' : (error as Error).message;
        // Unread body left (a refused or oversized request): don't wait for it.
        if (!req.readableEnded) res.setHeader('Connection', 'close');
        reply(res, STATUS[code], { error: code, message });
      },
    );
  };
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
