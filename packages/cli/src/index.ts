import { parseArgs } from 'node:util';
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
    return runServe(port, values.dir ?? '.field-notes', io);
  }
  io.stderr(`Unknown command: ${command}\n\n${USAGE}`);
  return 2;
}

async function runServe(port: number, dir: string, io: CliIo): Promise<number> {
  let serving;
  try {
    serving = await serve({ port, dir, version: io.version, widgetScript: io.widgetScript });
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
