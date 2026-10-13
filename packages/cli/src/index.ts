import { readFile, stat } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { MAX_IMPORT_BYTES, importBundle, isOriginPattern } from '@field-notes/sink';
import { serve } from './serve.ts';

export interface CliIo {
  version: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** The script-tag build that `serve` hands out, with its token placeholder. */
  widgetScript: () => Promise<string>;
  /** Stops a long-running command (`serve`): Ctrl+C. */
  signal: AbortSignal;
}

const USAGE = `Usage: field-notes <command> [options]

Commands:
  serve    Run the local sink: notes from the widget land in --dir
           --port <n>   Port on 127.0.0.1 (default 4747; 0 picks a free one)
           --dir <path> Where notes go (default .field-notes)
           --origin <origin>
                        Also take notes from this page origin (repeatable),
                        such as http://app.test:3000 or http://app.test:*.
                        Loopback over http and https is always allowed.
  import <export.zip>
           Add the notes in a zip exported from the widget to --dir
           --dir <path> Where notes go (default .field-notes)
           Notes already there are skipped, so importing again is safe.

Options:
  -h, --help     Show this help
  -v, --version  Show version
`;

/** Runs the CLI and resolves with the process exit code. */
export async function run(argv: readonly string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
        port: { type: 'string' },
        dir: { type: 'string' },
        origin: { type: 'string', multiple: true },
      },
    });
  } catch (error) {
    io.stderr(`${(error as Error).message}\n\n${USAGE}`);
    return 2;
  }

  const { values, positionals } = parsed;
  const [command] = positionals;
  if (values.version) {
    io.stdout(`${io.version}\n`);
    return 0;
  }
  if (values.help || command === undefined) {
    io.stdout(USAGE);
    return 0;
  }
  if (command === 'serve') {
    const port = Number(values.port ?? 4747);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      io.stderr(`--port must be a port number, not ${JSON.stringify(values.port)}\n`);
      return 2;
    }
    const origins = values.origin ?? [];
    const bad = origins.find((origin) => !isOriginPattern(origin));
    if (bad !== undefined) {
      io.stderr(
        `--origin must be an origin like http://app.test:3000, not ${JSON.stringify(bad)}\n`,
      );
      return 2;
    }
    return runServe(port, values.dir ?? '.field-notes', origins, io);
  }
  if (command === 'import') {
    const [, zip, ...extra] = positionals;
    if (zip === undefined || extra.length > 0) {
      io.stderr(`import takes one zip file\n\n${USAGE}`);
      return 2;
    }
    return runImport(zip, values.dir ?? '.field-notes', io);
  }
  io.stderr(`Unknown command: ${command}\n\n${USAGE}`);
  return 2;
}

const plural = (n: number, word: string): string => `${String(n)} ${word}${n === 1 ? '' : 's'}`;

async function runImport(zip: string, dir: string, io: CliIo): Promise<number> {
  let bytes: Uint8Array;
  try {
    if ((await stat(zip)).size > MAX_IMPORT_BYTES) {
      io.stderr(`${zip} is over ${String(MAX_IMPORT_BYTES / 2 ** 20)} MiB; not importing it.\n`);
      return 1;
    }
    bytes = await readFile(zip);
  } catch (error) {
    io.stderr(`Can't read ${zip}: ${(error as Error).message}\n`);
    return 1;
  }
  let outcome;
  try {
    outcome = await importBundle(dir, bytes);
  } catch (error) {
    io.stderr(`Couldn't import into ${dir}: ${(error as Error).message}\n`);
    return 1;
  }
  if (!outcome.ok) {
    io.stderr(`${zip} is not a field-notes export, or is damaged: ${outcome.error.message}\n`);
    return 1;
  }
  const { imported, skipped, conflicts } = outcome.value;
  const already = skipped.length ? ` (${plural(skipped.length, 'note')} already there)` : '';
  io.stdout(`Imported ${plural(imported.length, 'note')} into ${dir}${already}.\n`);
  for (const { id, dir: taken } of conflicts) {
    io.stderr(`Conflict: ${taken} holds another note, so ${id} was not imported.\n`);
  }
  return conflicts.length ? 1 : 0;
}

async function runServe(
  port: number,
  dir: string,
  origins: readonly string[],
  io: CliIo,
): Promise<number> {
  let serving;
  try {
    serving = await serve({
      port,
      dir,
      origins,
      version: io.version,
      widgetScript: io.widgetScript,
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    io.stderr(
      code === 'EADDRINUSE'
        ? `Port ${String(port)} is in use. Pick another with --port.\n`
        : `Couldn't start the sink: ${(error as Error).message}\n`,
    );
    return 1;
  }
  io.stdout(
    [
      `field-notes sink on ${serving.url}`,
      `  notes go to ${serving.dir}`,
      `  token: ${serving.token} (kept in ${serving.dir}/.token)`,
      '',
      'Add the widget to your app (dev only), as a script tag:',
      `  <script src="${serving.url}/widget.js"></script>`,
      'or from the npm package:',
      `  mountFieldNotes({ endpoint: '${serving.url}/__field-notes', token: '${serving.token}' })`,
      '',
    ].join('\n'),
  );
  if (!io.signal.aborted) {
    await new Promise((done) => {
      io.signal.addEventListener('abort', done, { once: true });
    });
  }
  await serving.close();
  return 0;
}
