// `list` and `show`: filters, and the text and JSON each prints. Notes are
// untrusted input (spec/SPEC.md), so text output drops control characters,
// which could otherwise rewrite the terminal. JSON escapes them already.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { NOTE_STATUSES, type Note, type NoteStatus } from '@field-notes/core';
import type { Item } from './notes.ts';

export const GROUPS = ['route', 'type', 'author'] as const;
export type Group = (typeof GROUPS)[number];

export interface Filters {
  readonly statuses: readonly NoteStatus[];
  readonly types: readonly string[];
  readonly authors: readonly string[];
  readonly routes: readonly RegExp[];
  /** Epoch ms; notes created before it are left out. */
  readonly since?: number | undefined;
}

export interface FilterOptions {
  status?: string[] | undefined;
  type?: string[] | undefined;
  author?: string[] | undefined;
  route?: string[] | undefined;
  since?: string | undefined;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const UNITS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

/** `30m`, `12h`, `2d` or `1w`, in ms. */
export function parseDuration(text: string): number | undefined {
  const match = /^(\d+)([mhdw])$/.exec(text);
  return match ? Number(match[1]) * (UNITS[match[2] ?? ''] ?? 0) : undefined;
}

/**
 * `30m`, `12h`, `2d`, `1w` before `now`, or an ISO date or date-time. A date,
 * or a date-time without an offset, is local time, as in git.
 */
function parseSince(text: string, now: number): number | undefined {
  const ago = parseDuration(text);
  if (ago !== undefined) return now - ago;
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (date) {
    const [year, month, day] = date.slice(1).map(Number) as [number, number, number];
    const midnight = new Date(year, month - 1, day);
    // No rolling over: 2026-02-30 isn't March 2nd.
    return midnight.getMonth() === month - 1 && midnight.getDate() === day
      ? midnight.getTime()
      : undefined;
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text)) return undefined;
  const time = Date.parse(text);
  return Number.isNaN(time) ? undefined : time;
}

/** A route pattern: `*` matches anything, everything else matches itself. */
function routePattern(pattern: string): RegExp {
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}$`, 's');
}

export function parseFilters(options: FilterOptions, now: number): Parsed<Filters> {
  const status = options.status ?? ['open'];
  let statuses: NoteStatus[];
  if (status.includes('all')) statuses = [...NOTE_STATUSES];
  else {
    const bad = status.find((s) => !(NOTE_STATUSES as readonly string[]).includes(s));
    if (bad !== undefined) {
      return {
        ok: false,
        error: `--status must be ${NOTE_STATUSES.join(', ')} or all, not ${JSON.stringify(bad)}`,
      };
    }
    statuses = status as NoteStatus[];
  }
  let since: number | undefined;
  if (options.since !== undefined) {
    since = parseSince(options.since, now);
    if (since === undefined) {
      return {
        ok: false,
        error: `--since must be like 30m, 12h, 2d, 1w or 2026-10-01, not ${JSON.stringify(options.since)}`,
      };
    }
  }
  return {
    ok: true,
    value: {
      statuses,
      types: (options.type ?? []).map((t) => t.toLowerCase()),
      authors: (options.author ?? []).map((a) => a.toLowerCase()),
      routes: (options.route ?? []).map(routePattern),
      since,
    },
  };
}

export function matches(note: Note, filters: Filters): boolean {
  const { statuses, types, authors, routes, since } = filters;
  if (!statuses.includes(note.status)) return false;
  if (types.length && !types.includes(note.type?.toLowerCase() ?? '')) return false;
  if (authors.length && !authors.includes(note.author?.toLowerCase() ?? '')) return false;
  const { route } = note;
  if (routes.length && (route === undefined || !routes.some((r) => r.test(route)))) return false;
  return since === undefined || Date.parse(note.created) >= since;
}

/** What `--json` prints for a note: see docs/cli.md. */
export interface JsonItem {
  readonly dir: string;
  readonly screenshot: string | null;
  readonly note: Note;
}

/** The screenshot's absolute path, or null when there's none or it isn't there. */
function screenshotPath(item: Item): string | null {
  const { screenshot } = item.note;
  if (!screenshot) return null;
  // The schema allows only a plain file name, so this stays in the note's directory.
  const path = join(item.dir, screenshot);
  return existsSync(path) ? path : null;
}

export function jsonItem(item: Item): JsonItem {
  return { dir: item.dir, screenshot: screenshotPath(item), note: item.note };
}

// C0 and C1 controls, DEL, and bidi overrides and isolates (Trojan Source).
// eslint-disable-next-line no-control-regex -- matching them is the point
const CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;
const LINE_BREAKS = /[\n\t]+/g;

/** Text from a note, safe to print: control characters dropped. */
export function clean(text: string): string {
  return text.replace(CONTROLS, '');
}

/** One line of text from a note: also no newlines or tabs. */
function cleanLine(text: string): string {
  return clean(text).replace(LINE_BREAKS, ' ').trim();
}

const SUMMARY_MAX = 72;

/** The body's first non-empty line, cut to fit a list row. */
function summary(note: Note): string {
  const line = cleanLine(note.body.split('\n').find((l) => l.trim()) ?? '');
  return line.length > SUMMARY_MAX ? `${line.slice(0, SUMMARY_MAX - 1)}…` : line;
}

const NONE: Record<Group, string> = {
  route: '(no route)',
  type: '(no type)',
  author: '(no author)',
};

/**
 * Notes in groups, groups in order of their first note, notes oldest first.
 * Types and authors are grouped in any case, as they're filtered, under the
 * first note's spelling.
 */
export function grouped(items: readonly Item[], group: Group): Map<string, Item[]> {
  const groups = new Map<string, { label: string; items: Item[] }>();
  for (const item of items) {
    const value = item.note[group];
    const label = value ? cleanLine(value) : NONE[group];
    const key = value && group !== 'route' ? label.toLowerCase() : label;
    const found = groups.get(key);
    if (found) found.items.push(item);
    else groups.set(key, { label, items: [item] });
  }
  return new Map([...groups.values()].map(({ label, items: members }) => [label, members]));
}

function rows(items: readonly Item[], indent = ''): string {
  const cells = items.map(({ note }) => [
    cleanLine(note.id),
    note.status,
    note.type ? cleanLine(note.type) : '-',
    note.route ? cleanLine(note.route) : '-',
    summary(note),
  ]);
  const widths = [0, 1, 2, 3].map((i) => Math.max(...cells.map((row) => row[i]?.length ?? 0)));
  return cells
    .map(
      (row) =>
        indent +
        row
          .map((cell, i) => cell.padEnd(widths[i] ?? 0))
          .join('  ')
          .trimEnd(),
    )
    .join('\n');
}

/** `list`'s text: one row per note, under a heading per group with `--group-by`. */
export function listText(items: readonly Item[], group?: Group): string {
  if (!group) return `${rows(items)}\n`;
  return [...grouped(items, group)]
    .map(([name, members]) => `${name} (${String(members.length)})\n${rows(members, '  ')}\n`)
    .join('\n');
}

/** `show`'s text: the fields worth reading, then the body. */
export function showText(item: Item): string {
  const { note } = item;
  const shot = screenshotPath(item);
  const fields: [string, string | undefined][] = [
    ['status', note.status],
    ['type', note.type],
    ['author', note.author],
    ['created', note.created],
    ['environment', note.environment],
    ['url', note.url],
    ['route', note.route],
    ['title', note.title],
    ['element', note.element?.selector],
    ['selection', note.selection ?? undefined],
    ['tags', note.tags?.length ? note.tags.join(', ') : undefined],
    ['resolution', note.resolution ?? undefined],
    [
      'screenshot',
      shot ?? (note.screenshot ? `${note.screenshot} (not in the note's directory)` : undefined),
    ],
    ['dir', item.dir],
  ];
  const head = fields
    .filter((field): field is [string, string] => field[1] !== undefined && field[1] !== '')
    .map(([name, value]) => `${name}: ${cleanLine(value)}`);
  const body = clean(note.body).replace(/\s+$/, '');
  return `${cleanLine(note.id)}\n${head.join('\n')}\n${body ? `\n${body}\n` : ''}`;
}
