// `field-notes/middleware`: mounts the sink on a Connect or Express dev
// server. In production it stands aside, unless forced.
import { resolve } from 'node:path';
import { type SinkHandler, createSinkHandler } from './handler.ts';
import { DEFAULT_ALLOWED_ORIGINS } from './origin.ts';
import { prepareSinkDir } from './setup.ts';

export interface FieldNotesMiddlewareOptions {
  /** Where notes go. Default `.field-notes` in the working directory. */
  readonly dir?: string | undefined;
  /** Page origins allowed besides loopback over http and https. */
  readonly origins?: readonly string[] | undefined;
  /** Mount even when `NODE_ENV` is `production`. */
  readonly force?: boolean | undefined;
}

/**
 * Takes notes at `/__field-notes`; other requests go to `next`. Mount it
 * before body parsers. A widget on the server's own pages gets the token
 * from there, so it needs no options, when the page is opened on this
 * machine; a page on another device needs `token` given, and `origins`.
 *
 * With `NODE_ENV=production` (and no `force`) it creates nothing, warns once
 * and passes every request on, so a forgotten dev-only guard can't open a
 * sink on a production server, or crash it.
 */
export function fieldNotesMiddleware(options: FieldNotesMiddlewareOptions = {}): SinkHandler {
  if (process.env.NODE_ENV === 'production' && !options.force) {
    console.warn(
      '[field-notes] NODE_ENV is production, so the middleware is off. Pass { force: true } to mount it anyway.',
    );
    return (_req, _res, next) => {
      next?.();
    };
  }
  const dir = resolve(options.dir ?? '.field-notes');
  return createSinkHandler({
    dir,
    token: prepareSinkDir(dir),
    allowedOrigins: [...DEFAULT_ALLOWED_ORIGINS, ...(options.origins ?? [])],
    tokenToSameOrigin: true,
  });
}
