// `field-notes/vite`: mounts the sink on Vite's dev server. Dev only
// (`apply: 'serve'`), and nothing happens until the dev server starts, so
// `vite build` and `vite preview` never touch `.field-notes/`.
import { resolve } from 'node:path';
import { type SinkHandler, createSinkHandler } from './handler.ts';
import { DEFAULT_ALLOWED_ORIGINS } from './origin.ts';
import { prepareSinkDir } from './setup.ts';

export interface FieldNotesViteOptions {
  /** Where notes go. Default `.field-notes` in Vite's root. */
  readonly dir?: string | undefined;
  /**
   * Page origins allowed besides loopback over http and https, such as
   * `http://app.test:5173` for a custom dev hostname.
   */
  readonly origins?: readonly string[] | undefined;
}

/** The parts of Vite's dev server the plugin uses. */
export interface FieldNotesViteServer {
  readonly config: { readonly root: string };
  readonly middlewares: { readonly use: (handler: SinkHandler) => unknown };
}

/**
 * A Vite plugin, typed structurally so this package needs no Vite types.
 * Assignable to Vite's `Plugin`.
 */
export interface FieldNotesVitePlugin {
  readonly name: 'field-notes';
  readonly apply: 'serve';
  readonly configureServer: (server: FieldNotesViteServer) => void;
}

/**
 * Takes notes at `/__field-notes` on the dev server. A widget on the dev
 * server's pages gets the token from there, so it needs no options, as long
 * as the page is opened on this machine. A page on another device (`vite
 * --host`) needs `token` given, and its origin in `origins`.
 */
export function fieldNotes(options: FieldNotesViteOptions = {}): FieldNotesVitePlugin {
  return {
    name: 'field-notes',
    apply: 'serve',
    configureServer: (server) => {
      const dir = resolve(server.config.root, options.dir ?? '.field-notes');
      const token = prepareSinkDir(dir);
      // Before Vite's own middlewares, which would answer the path first.
      server.middlewares.use(
        createSinkHandler({
          dir,
          token,
          allowedOrigins: [...DEFAULT_ALLOWED_ORIGINS, ...(options.origins ?? [])],
          tokenToSameOrigin: true,
        }),
      );
    },
  };
}
