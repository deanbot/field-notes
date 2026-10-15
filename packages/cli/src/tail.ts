// `tail`: prints each note that lands in `items/` once, as it lands. Watch
// events only say that something changed, so each one rereads `items/` for
// directories not seen yet: events that are merged, dropped or misnamed (as
// recursive watches do, by platform) can't lose a note or print one twice.
import { watch } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { cleanLine, jsonItem, summary } from './list.ts';
import { type Item, readBacklog } from './notes.ts';

export interface TailOptions {
  /** The notes directory, absolute. */
  readonly root: string;
  readonly json: boolean;
  /** Epoch ms: also print notes already there and created since. */
  readonly since?: number | undefined;
  readonly signal: AbortSignal;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

/** How often to look for `items/` until it exists. */
const WAIT_MS = 500;
/**
 * How often to look again at a directory without `note.md`, and for how
 * long. A recursive watch on Linux can miss what lands in a directory made a
 * moment before, as the sink's are; the event for the directory still comes.
 */
const RETRY_MS = 100;
const RETRY_FOR_MS = 5000;

/** One line per note: compact JSON, or its id, type, route and first line. */
function line(item: Item, json: boolean): string {
  if (json) return `${JSON.stringify(jsonItem(item))}\n`;
  const { note } = item;
  const cells = [
    cleanLine(note.id),
    note.type ? cleanLine(note.type) : '-',
    note.route ? cleanLine(note.route) : '-',
    summary(note),
  ];
  return `${cells.join('  ').trimEnd()}\n`;
}

/** Resolves with the exit code once `signal` aborts, or the watch fails. */
export async function tail(options: TailOptions): Promise<number> {
  const { root, json, since, signal, stdout, stderr } = options;
  const itemsDir = join(root, 'items');
  let watcher;
  for (let waited = false; ; waited = true) {
    try {
      // Looked for first: a recursive watch on Linux doesn't always throw
      // for a directory that isn't there.
      await stat(itemsDir);
      watcher = watch(itemsDir, { recursive: true, signal });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        stderr(`Can't watch ${itemsDir}: ${(error as Error).message}\n`);
        return 1;
      }
      if (!waited) stderr(`Waiting for ${itemsDir} to be made…\n`);
      try {
        await sleep(WAIT_MS, undefined, { signal });
      } catch {
        return 0; // Stopped while waiting.
      }
    }
  }

  const seen = new Set<string>();
  const reported = new Set<string>();
  const pendingSince = new Map<string, number>();
  let retry: NodeJS.Timeout | undefined;
  let scanning: Promise<void> | undefined;
  let again = false;
  // A function, since `again` changes while a scan awaits.
  const more = (): boolean => again && !signal.aborted;

  const print = (items: readonly Item[], printed = true): void => {
    for (const item of items) {
      const name = basename(item.dir);
      // Checked and marked with no await between: never printed twice.
      if (seen.has(name)) continue;
      seen.add(name);
      pendingSince.delete(name);
      if (printed) stdout(line(item, json));
    }
  };

  const scan = async (): Promise<void> => {
    let backlog;
    try {
      backlog = await readBacklog(root, seen);
    } catch (error) {
      stderr(`Can't read notes in ${root}: ${(error as Error).message}\n`);
      return;
    }
    if (signal.aborted) return;
    print(backlog.items);
    for (const { dir, reason } of backlog.skipped) {
      // Not marked seen: if it's fixed, it's printed then.
      if (reported.has(dir)) continue;
      reported.add(dir);
      stderr(`Skipped ${cleanLine(dir)}: ${cleanLine(reason)}\n`);
    }
    const now = Date.now();
    for (const name of backlog.pending) {
      if (!pendingSince.has(name)) pendingSince.set(name, now);
    }
    const waiting = backlog.pending.some(
      (name) => now - (pendingSince.get(name) ?? now) < RETRY_FOR_MS,
    );
    if (waiting && !retry) {
      retry = setTimeout(() => {
        retry = undefined;
        rescan();
      }, RETRY_MS);
    }
  };

  /** Scans now, or once more after the scan running now. */
  function rescan(): void {
    if (signal.aborted) return;
    if (scanning) {
      again = true;
      return;
    }
    scanning = (async () => {
      do {
        again = false;
        await scan();
      } while (more());
      scanning = undefined;
    })();
  }

  const failed = new Promise<number>((done) => {
    watcher.on('error', (error) => {
      stderr(`Stopped watching ${itemsDir}: ${error.message}\n`);
      done(1);
    });
  });
  watcher.on('change', rescan);

  // The notes there by the baseline aren't new: they're printed only for
  // --since. Notes landing after it are, and the watch is already running.
  try {
    const baseline = await readBacklog(root);
    for (const { dir } of baseline.skipped) seen.add(basename(dir));
    print(
      baseline.items.filter(
        (item) => since !== undefined && Date.parse(item.note.created) >= since,
      ),
    );
    print(baseline.items, false);
    for (const name of baseline.pending) pendingSince.set(name, Date.now());
  } catch (error) {
    stderr(`Can't read notes in ${root}: ${(error as Error).message}\n`);
    watcher.close();
    return 1;
  }
  stderr(`Watching ${itemsDir} for new notes. Ctrl+C stops.\n`);
  rescan();

  const stopped = new Promise<number>((done) => {
    if (signal.aborted) done(0);
    else {
      signal.addEventListener(
        'abort',
        () => {
          done(0);
        },
        { once: true },
      );
    }
  });
  const code = await Promise.race([stopped, failed]);
  watcher.close();
  clearTimeout(retry);
  await scanning;
  return code;
}
