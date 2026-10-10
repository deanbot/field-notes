import { parseArgs } from 'node:util';

export interface CliIo {
  version: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const USAGE = `Usage: field-notes <command> [options]

Options:
  -h, --help     Show this help
  -v, --version  Show version

Commands arrive in later milestones (serve, list, show, resolve, import, export, ...).
`;

/** Runs the CLI and returns the process exit code. */
export function run(argv: readonly string[], io: CliIo): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
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
  io.stderr(`Unknown command: ${command}\n\n${USAGE}`);
  return 2;
}
