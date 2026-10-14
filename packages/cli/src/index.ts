import { readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { NoteStatus } from '@field-notes/core';
import {
  MAX_IMPORT_BYTES,
  forgetOldClientIds,
  importBundle,
  isOriginPattern,
} from '@field-notes/sink';
import {
  GROUPS,
  clean,
  type Group,
  grouped,
  jsonItem,
  listText,
  matches,
  parseDuration,
  parseFilters,
  showText,
} from './list.ts';
import { FORMATS, type Format, digest } from './export.ts';
import { type Backlog, type Item, findNote, readBacklog } from './notes.ts';
import { serve } from './serve.ts';
import { PRUNABLE, prune, resolutionOf, setStatus } from './status.ts';

export interface CliIo {
  version: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** The script-tag build that `serve` hands out, with its token placeholder. */
  widgetScript: () => Promise<string>;
  /** Stops a long-running command (`serve`): Ctrl+C. */
  signal: AbortSignal;
  /** The time, for `--since` and `prune`; `Date.now` if not given. */
  now?: () => number;
}

const DOCS = 'https://github.com/deanbot/field-notes/blob/main/docs/cli.md';

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
  list     List notes in --dir, oldest first
           --status <s>  open (default), resolved, wontfix or all (repeatable)
           --type <t>    Only this type (repeatable; any case)
           --author <a>  Only this author (repeatable; any case)
           --route <r>   Only this route (repeatable); * matches anything,
                         as in /checkout/*
           --since <t>   Created in the last 30m, 12h, 2d or 1w, or since
                         a date like 2026-10-01
           --group-by <g>
                         Group by route, type or author
           --json        Print JSON
           --dir <path>  Where notes are (default .field-notes)
  show <id>
           Show a note: its id, or the start of it
           --json        Print JSON
           --dir <path>  Where notes are (default .field-notes)
  export   Print one digest of notes, for a meeting, a doc or a spreadsheet
           --format <f>  md (default), json or csv
           --group-by <g>
                         Group by route (default), type or author
           --out <file>  Write it to this file; screenshot paths are then
                         relative to it, not to the current directory
           --status, --type, --author, --route, --since
                         As for list
           --dir <path>  Where notes are (default .field-notes)
  resolve <id...>
           Mark notes resolved
           --note <text> Why: what was done (required)
           --ref <ref>   A commit, PR or issue it was done in
           --dir <path>  Where notes are (default .field-notes)
  wontfix <id...>
           Mark notes won't fix
           --note <text> Why not (required)
           --ref <ref>   Where it was decided
           --dir <path>  Where notes are (default .field-notes)
  reopen <id...>
           Mark notes open again, clearing the resolution
           --dir <path>  Where notes are (default .field-notes)
  prune    Delete resolved and won't-fix notes, never open ones
           --older-than <t>
                         Unchanged for this long: 30m, 12h, 2d or 1w (required)
           --status <s>  resolved or wontfix (repeatable; default both)
           --dry-run     List what would be deleted, deleting nothing
           --dir <path>  Where notes are (default .field-notes)

Options:
  -h, --help     Show this help
  -v, --version  Show version

More, including the JSON shape: ${DOCS}
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
        status: { type: 'string', multiple: true },
        type: { type: 'string', multiple: true },
        author: { type: 'string', multiple: true },
        route: { type: 'string', multiple: true },
        since: { type: 'string' },
        'group-by': { type: 'string' },
        json: { type: 'boolean' },
        note: { type: 'string' },
        ref: { type: 'string' },
        'older-than': { type: 'string' },
        'dry-run': { type: 'boolean' },
        format: { type: 'string' },
        out: { type: 'string' },
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
  const allowed = OPTIONS[command];
  if (allowed) {
    const extra = Object.keys(values).find((name) => !allowed.includes(name));
    if (extra !== undefined) {
      io.stderr(`${command} doesn't take --${extra}\n\n${USAGE}`);
      return 2;
    }
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
  if (command === 'list') {
    if (positionals.length > 1) {
      io.stderr(`list takes no arguments\n\n${USAGE}`);
      return 2;
    }
    const filters = parseFilters(values, (io.now ?? Date.now)());
    if (!filters.ok) {
      io.stderr(`${filters.error}\n`);
      return 2;
    }
    const group = values['group-by'];
    if (group !== undefined && !isGroup(group)) {
      io.stderr(`--group-by must be ${GROUPS.join(', ')}, not ${JSON.stringify(group)}\n`);
      return 2;
    }
    const backlog = await load(values.dir ?? '.field-notes', io);
    if (!backlog) return 1;
    const items = backlog.items.filter((item) => matches(item.note, filters.value));
    if (values.json) {
      const ordered = group ? [...grouped(items, group).values()].flat() : items;
      io.stdout(`${JSON.stringify(ordered.map(jsonItem), null, 2)}\n`);
    } else if (items.length) io.stdout(listText(items, group));
    else io.stderr('No notes match.\n');
    return 0;
  }
  if (command === 'export') {
    if (positionals.length > 1) {
      io.stderr(`export takes no arguments\n\n${USAGE}`);
      return 2;
    }
    const filters = parseFilters(values, (io.now ?? Date.now)());
    if (!filters.ok) {
      io.stderr(`${filters.error}\n`);
      return 2;
    }
    const format = values.format ?? 'md';
    if (!isFormat(format)) {
      io.stderr(`--format must be ${FORMATS.join(', ')}, not ${JSON.stringify(format)}\n`);
      return 2;
    }
    const group = values['group-by'] ?? 'route';
    if (!isGroup(group)) {
      io.stderr(`--group-by must be ${GROUPS.join(', ')}, not ${JSON.stringify(group)}\n`);
      return 2;
    }
    const backlog = await load(values.dir ?? '.field-notes', io);
    if (!backlog) return 1;
    const items = backlog.items.filter((item) => matches(item.note, filters.value));
    const { out } = values;
    const text = digest(items, {
      format,
      group,
      statuses: filters.value.statuses,
      base: out === undefined ? resolve() : dirname(resolve(out)),
    });
    if (!items.length) io.stderr('No notes match.\n');
    if (out === undefined) {
      io.stdout(text);
      return 0;
    }
    try {
      await writeFile(out, text);
    } catch (error) {
      io.stderr(`Couldn't write ${out}: ${(error as Error).message}\n`);
      return 1;
    }
    io.stderr(`Wrote ${plural(items.length, 'note')} to ${out}\n`);
    return 0;
  }
  if (command === 'show') {
    const [, id, ...extra] = positionals;
    if (!id || extra.length > 0) {
      io.stderr(`show takes one note id\n\n${USAGE}`);
      return 2;
    }
    const backlog = await load(values.dir ?? '.field-notes', io);
    if (!backlog) return 1;
    const [item] = lookup(backlog.items, [id], io) ?? [];
    if (!item) return 1;
    io.stdout(values.json ? `${JSON.stringify(jsonItem(item), null, 2)}\n` : showText(item));
    return 0;
  }
  if (command === 'resolve' || command === 'wontfix' || command === 'reopen') {
    const ids = positionals.slice(1);
    if (!ids.length) {
      io.stderr(`${command} takes one or more note ids\n\n${USAGE}`);
      return 2;
    }
    let resolution: string | null = null;
    if (command !== 'reopen') {
      const note = values.note?.trim();
      if (!note) {
        io.stderr(`${command} needs --note, saying why\n`);
        return 2;
      }
      resolution = resolutionOf(note, values.ref?.trim());
    }
    const status = STATUS_OF[command];
    return runStatus(ids, status, resolution, values.dir ?? '.field-notes', io);
  }
  if (command === 'prune') {
    if (positionals.length > 1) {
      io.stderr(`prune takes no arguments\n\n${USAGE}`);
      return 2;
    }
    const age =
      values['older-than'] === undefined ? undefined : parseDuration(values['older-than']);
    if (age === undefined) {
      io.stderr(`prune needs --older-than, like 30m, 12h, 2d or 1w\n`);
      return 2;
    }
    const statuses = values.status ?? [...PRUNABLE];
    const bad = statuses.find((s) => !(PRUNABLE as readonly string[]).includes(s));
    if (bad !== undefined) {
      io.stderr(
        `prune never deletes open notes: --status must be resolved or wontfix, not ${JSON.stringify(bad)}\n`,
      );
      return 2;
    }
    return runPrune(
      statuses as NoteStatus[],
      age,
      values['dry-run'] ?? false,
      values.dir ?? '.field-notes',
      io,
    );
  }
  io.stderr(`Unknown command: ${command}\n\n${USAGE}`);
  return 2;
}

const STATUS_OF = { resolve: 'resolved', wontfix: 'wontfix', reopen: 'open' } as const;
const DONE: Record<NoteStatus, string> = {
  resolved: 'Resolved',
  wontfix: "Marked won't fix:",
  open: 'Reopened',
};
const ALREADY: Record<NoteStatus, string> = {
  resolved: 'is already resolved',
  wontfix: "is already won't fix",
  open: 'is already open',
};

/**
 * The note for each id, or undefined, after saying why on stderr, if any id
 * fits no note or more than one. A note named twice is listed once.
 */
function lookup(items: readonly Item[], ids: readonly string[], io: CliIo): Item[] | undefined {
  const found = new Map<string, Item>();
  let failed = false;
  for (const id of ids) {
    const match = findNote(items, id);
    if (match.ok) {
      found.set(match.item.dir, match.item);
      continue;
    }
    failed = true;
    if (!match.matches.length) io.stderr(`No note has the id ${JSON.stringify(id)}.\n`);
    else {
      io.stderr(`${JSON.stringify(id)} could be any of these notes:\n`);
      for (const { note, dir } of match.matches) io.stderr(`  ${clean(note.id)}  ${clean(dir)}\n`);
    }
  }
  return failed ? undefined : [...found.values()];
}

/** Changes every note or, if any id doesn't fit exactly one note, none. */
async function runStatus(
  ids: readonly string[],
  status: NoteStatus,
  resolution: string | null,
  dir: string,
  io: CliIo,
): Promise<number> {
  const backlog = await load(dir, io);
  if (!backlog) return 1;
  const items = lookup(backlog.items, ids, io);
  if (!items) {
    io.stderr('Nothing was changed.\n');
    return 1;
  }
  let code = 0;
  for (const item of items) {
    const id = clean(item.note.id);
    try {
      if (await setStatus(item, status, resolution)) io.stdout(`${DONE[status]} ${id}\n`);
      else io.stdout(`${id} ${ALREADY[status]}\n`);
    } catch (error) {
      io.stderr(`Couldn't change ${id}: ${clean((error as Error).message)}\n`);
      code = 1;
    }
  }
  return code;
}

async function runPrune(
  statuses: readonly NoteStatus[],
  age: number,
  dryRun: boolean,
  dir: string,
  io: CliIo,
): Promise<number> {
  const backlog = await load(dir, io);
  if (!backlog) return 1;
  const now = (io.now ?? Date.now)();
  try {
    const removed = await prune(backlog.items, statuses, age, now, dryRun);
    for (const { note, dir: gone } of removed) {
      io.stdout(`${dryRun ? 'Would delete' : 'Deleted'} ${clean(note.id)}  ${clean(gone)}\n`);
    }
    if (!removed.length) io.stderr('No notes to delete.\n');
    // The sink's records of notes it was sent, for answering a resend.
    if (!dryRun) await forgetOldClientIds(resolve(dir), now);
  } catch (error) {
    io.stderr(`Couldn't prune ${dir}: ${(error as Error).message}\n`);
    return 1;
  }
  return 0;
}

/** The options each command takes. */
const OPTIONS: Readonly<Record<string, readonly string[]>> = {
  serve: ['port', 'dir', 'origin'],
  import: ['dir'],
  list: ['status', 'type', 'author', 'route', 'since', 'group-by', 'json', 'dir'],
  show: ['json', 'dir'],
  export: ['status', 'type', 'author', 'route', 'since', 'group-by', 'format', 'out', 'dir'],
  resolve: ['note', 'ref', 'dir'],
  wontfix: ['note', 'ref', 'dir'],
  reopen: ['dir'],
  prune: ['older-than', 'status', 'dry-run', 'dir'],
};

const isGroup = (value: string): value is Group => (GROUPS as readonly string[]).includes(value);
const isFormat = (value: string): value is Format => (FORMATS as readonly string[]).includes(value);

/** Reads the backlog, reporting on stderr each directory that isn't a note. */
async function load(dir: string, io: CliIo): Promise<Backlog | undefined> {
  let backlog;
  try {
    backlog = await readBacklog(resolve(dir));
  } catch (error) {
    io.stderr(`Can't read notes in ${dir}: ${(error as Error).message}\n`);
    return undefined;
  }
  for (const { dir: skipped, reason } of backlog.skipped) {
    io.stderr(`Skipped ${clean(skipped)}: ${clean(reason)}\n`);
  }
  return backlog;
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
    io.stderr(`Conflict: ${taken} holds another note, so ${clean(id)} was not imported.\n`);
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
