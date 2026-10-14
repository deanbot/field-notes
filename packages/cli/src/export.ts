// `export`: one digest of the notes, for a meeting, a doc or a spreadsheet.
// Notes are untrusted input (spec/SPEC.md), and a digest is pasted where it
// will be rendered. In markdown, a note's text can't add HTML or images, hide
// a link's target, or reach outside its own section; a CSV cell can't become
// a formula. docs/cli.md lists what's left.
import { relative, sep } from 'node:path';
import type { NoteStatus } from '@field-notes/core';
import type { Item } from './notes.ts';
import {
  type Group,
  type JsonItem,
  clean,
  cleanLine,
  grouped,
  jsonItem,
  screenshotPath,
  summary,
} from './list.ts';

export const FORMATS = ['md', 'json', 'csv'] as const;
export type Format = (typeof FORMATS)[number];

export interface DigestOptions {
  readonly format: Format;
  readonly group: Group;
  /** The statuses filtered on, for the digest's heading. */
  readonly statuses: readonly NoteStatus[];
  /** Where the digest will be read from: screenshot paths are relative to it. */
  readonly base: string;
}

/** What `export --format json` prints: see docs/cli.md. */
interface JsonDigest {
  readonly groupBy: Group;
  readonly groups: readonly { readonly value: string | null; readonly notes: JsonItem[] }[];
}

export function digest(items: readonly Item[], options: DigestOptions): string {
  const groups = grouped(items, options.group);
  if (options.format === 'json') {
    const json: JsonDigest = {
      groupBy: options.group,
      groups: [...groups.values()].map((members) => ({
        value: members[0]?.note[options.group] ?? null,
        notes: members.map(jsonItem),
      })),
    };
    return `${JSON.stringify(json, null, 2)}\n`;
  }
  return options.format === 'csv'
    ? csv([...groups.values()].flat(), options.base)
    : markdown(groups, items.length, options);
}

/** The fields a digest shows, in order, as text: the body and id aside. */
function fields(item: Item, base: string): [string, string][] {
  const { note } = item;
  const shot = screenshotPath(item);
  const all: [string, string | undefined][] = [
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
      shot
        ? relativePath(base, shot)
        : note.screenshot
          ? `${note.screenshot} (not in the note's directory)`
          : undefined,
    ],
  ];
  return all.filter((field): field is [string, string] => !!field[1]);
}

/** `path` from `base`, with `/` between segments, as links want. */
function relativePath(base: string, path: string): string {
  return relative(base, path).split(sep).join('/');
}

// --- Markdown ---

// Characters that could start markup inside a line: emphasis, code, links,
// images, HTML, entities, tables, strikethrough, and a heading's closing #s.
const INLINE = /[\\`*_[\]<>|~&#]/g;

/** One line of note text as markdown that shows exactly that text. */
function inline(text: string): string {
  return cleanLine(text).replace(INLINE, '\\$&');
}

/** Code spans and URLs, which escaping would show: a code span. */
function code(text: string): string {
  const line = cleanLine(text);
  const longest = Math.max(0, ...(line.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  const pad = line.startsWith('`') || line.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${line}${pad}${fence}`;
}

const AS_CODE = new Set(['url', 'route', 'element', 'screenshot']);

/**
 * The body as a blockquote, so no line can end the note's section. It stays
 * markdown, but without HTML, links or images: outside code, `<`, `[` and
 * backticks that don't pair up are escaped. Code is left as written, inside
 * delimiters chosen here rather than the body's own, so that what markdown
 * reads as code is exactly what this does. Where a fence opens and closes
 * only decides how code looks: each is written out again from the quote's
 * start, which ends any list or nested quote around it.
 */
function quote(body: string): string {
  const out: string[] = [];
  let fence: { mark: string; size: number; info: string; lines: string[] } | undefined;
  for (const line of clean(body).replace(/\s+$/, '').split('\n').map(untab)) {
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line)?.[1];
      if (close?.[0] === fence.mark && close.length >= fence.size) {
        out.push(...fenced(fence.info, fence.lines));
        fence = undefined;
      } else fence.lines.push(line);
      continue;
    }
    const [, run, info = ''] = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line) ?? [];
    if (run && !(run.startsWith('`') && info.includes('`'))) {
      fence = { mark: run.charAt(0), size: run.length, info, lines: [] };
      continue;
    }
    out.push(escapeLine(line));
  }
  if (fence) out.push(...fenced(fence.info, fence.lines));
  return out.map((line) => (line ? `> ${line}` : '>')).join('\n');
}

/** Leading tabs as spaces, so indentation here is what markdown sees. */
const untab = (line: string): string =>
  line.replace(/^[ \t]+/, (space) => space.replace(/\t/g, '    '));

/**
 * A fenced code block, opening at the start of the quote (so it can't belong
 * to a list or a nested quote) with a fence no line inside can close.
 */
function fenced(info: string, lines: readonly string[]): string[] {
  const longest = Math.max(
    2,
    ...(lines
      .join('\n')
      .match(/`+/g)
      ?.map((run) => run.length) ?? []),
  );
  const fence = '`'.repeat(longest + 1);
  const language = /^\s*([\w+#.-]+)/.exec(info)?.[1] ?? '';
  return [`${fence}${language}`, ...lines, fence];
}

/**
 * One line of the body outside code. A backtick run with a run of the same
 * length later in the line is a code span, kept as written; every other
 * backtick is escaped, so no span can start here and end on another line.
 */
function escapeLine(line: string): string {
  let out = '';
  let rest = line;
  for (;;) {
    const open = /`+/.exec(rest);
    if (!open) return out + escapeText(rest);
    out += escapeText(rest.slice(0, open.index));
    const run = open[0];
    const after = rest.slice(open.index + run.length);
    const close = new RegExp(`(?<!\`)${run}(?!\`)`).exec(after);
    if (close) {
      out += run + after.slice(0, close.index) + run;
      rest = after.slice(close.index + run.length);
    } else {
      out += run.replace(/`/g, '\\`');
      rest = after;
    }
  }
}

const escapeText = (text: string): string => text.replace(/[\\<[]/g, '\\$&');

/** A link to a file, percent-encoded so any path stays one link. */
function link(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/\(/g, '%28').replace(/\)/g, '%29'))
    .join('/');
}

function noteMarkdown(item: Item, base: string): string {
  const { note } = item;
  const title = summary(note) || note.id;
  const lines = [`### ${inline(title)}`, '', `- **id:** ${code(note.id)}`];
  const shot = screenshotPath(item);
  for (const [name, value] of fields(item, base)) {
    const text =
      name === 'screenshot' && !shot && note.screenshot
        ? `${code(note.screenshot)} (not in the note's directory)`
        : AS_CODE.has(name)
          ? code(value)
          : inline(value);
    lines.push(`- **${name}:** ${text}`);
  }
  if (note.body.trim()) lines.push('', quote(note.body));
  if (shot) lines.push('', `![Screenshot](${link(relativePath(base, shot))})`);
  return lines.join('\n');
}

function markdown(groups: Map<string, Item[]>, count: number, options: DigestOptions): string {
  const head = [
    '# Field notes',
    '',
    `${plural(count, 'note')} (${options.statuses.join(', ')}), by ${options.group}.`,
  ];
  const sections = [...groups].map(([label, members]) =>
    [
      `## ${inline(label)} (${String(members.length)})`,
      ...members.map((item) => noteMarkdown(item, options.base)),
    ].join('\n\n'),
  );
  return `${[head.join('\n'), ...sections].join('\n\n')}\n`;
}

const plural = (n: number, word: string): string => `${String(n)} ${word}${n === 1 ? '' : 's'}`;

// --- CSV ---

const COLUMNS = [
  'id',
  'status',
  'type',
  'author',
  'created',
  'environment',
  'url',
  'route',
  'title',
  'element',
  'selection',
  'tags',
  'resolution',
  'screenshot',
  'body',
] as const;

/**
 * A CSV cell (RFC 4180). One starting with `=`, `+`, `-`, `@`, a tab or a
 * carriage return gets a `'` first, so a spreadsheet shows it as text rather
 * than running it as a formula.
 */
function cell(value: string): string {
  const text = clean(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function row(item: Item, base: string): string {
  const values: Partial<Record<(typeof COLUMNS)[number], string>> = {
    id: item.note.id,
    body: item.note.body.replace(/\s+$/, ''),
    ...Object.fromEntries(fields(item, base)),
  };
  return COLUMNS.map((column) => cell(values[column] ?? '')).join(',');
}

/**
 * One row per note, in group order. With a byte order mark, so Excel reads it
 * as UTF-8, and CRLF line breaks, as RFC 4180 has them.
 */
function csv(items: readonly Item[], base: string): string {
  return `\uFEFF${[COLUMNS.join(','), ...items.map((item) => row(item, base))].join('\r\n')}\r\n`;
}
