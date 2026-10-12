import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  appendToNotes,
  noteDirName,
  parseNote,
  serializeNote,
  ulid,
  updateNote,
  type Note,
  type NoteResult,
} from './index.ts';

const fixtures = new URL('../../../spec/fixtures/valid/', import.meta.url);
const validNotes: [string, Note][] = readdirSync(fixtures).map((file) => [
  file,
  JSON.parse(readFileSync(new URL(file, fixtures), 'utf8')) as Note,
]);

const minimal: Note = {
  id: '01JA8X3Q7K2M9V5T0N4R6P8W1Y',
  schema: 1,
  status: 'open',
  created: '2026-10-09T18:42:11.204Z',
  body: 'Button label is wrong.\n',
};

function value<T>(result: NoteResult<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

function errorCode(result: NoteResult<unknown>): string | undefined {
  return result.ok ? undefined : result.error.code;
}

describe('serializeNote / parseNote', () => {
  it.each(validNotes)('round-trips %s losslessly', (_, note) => {
    expect(value(parseNote(serializeNote(note)))).toEqual(note);
  });

  it.each([
    ['empty', ''],
    ['no trailing newline', 'text'],
    ['leading blank lines', '\n\n\ntext\n'],
    ['a --- line', 'above\n---\nbelow\n'],
    ['frontmatter-looking text', '---\nid: fake\n---\n'],
    ['unicode', 'Café — 日本語 🚀 \u202e\n'],
    ['CRLF', 'a\r\nb\r\n'],
    ['trailing whitespace', 'text  \n\n  '],
  ])('keeps a body with %s', (_, body) => {
    expect(value(parseNote(serializeNote({ ...minimal, body }))).body).toBe(body);
  });

  it.each([
    ['look like other types', { a: 'null', b: 'true', c: '12', d: '2026-10-09', e: '' }],
    ['contain YAML syntax', { a: 'a: b', b: '# x', c: '- item', d: '---', e: '{ x }' }],
    ['span lines', { a: 'one\ntwo\n', b: ' padded ', c: 'tab\there' }],
    ['are unicode', { a: 'Café — 日本語 🚀', b: '\u0000\u0007' }],
    ['are nested', { a: { b: [1, { c: null }] }, d: [] }],
    [
      'are named like Object.prototype members',
      { toString: 't', constructor: 'c', hasOwnProperty: 1, valueOf: { a: 1 } },
    ],
  ])('keeps unknown fields whose values %s', (_, extra) => {
    const note = { ...minimal, ...extra };
    expect(value(parseNote(serializeNote(note)))).toEqual(note);
  });

  it('writes known fields in spec order, then unknown ones', () => {
    const text = serializeNote({ zeta: 1, ...minimal, tags: [], type: 'idea' });
    const keys = [...text.matchAll(/^(\w+):/gm)].map((match) => match[1]);
    expect(keys).toEqual(['id', 'schema', 'status', 'type', 'created', 'tags', 'zeta']);
  });

  it('writes the documented layout', () => {
    expect(serializeNote({ ...minimal, tags: [] })).toBe(
      [
        '---',
        'id: 01JA8X3Q7K2M9V5T0N4R6P8W1Y',
        'schema: 1',
        'status: open',
        'created: "2026-10-09T18:42:11.204Z"',
        'tags: []',
        '---',
        '',
        'Button label is wrong.',
        '',
      ].join('\n'),
    );
  });

  it('reads hand-written files: CRLF, a BOM, no blank line before the body', () => {
    const text =
      '\uFEFF---\r\nid: x\r\nschema: 1\r\nstatus: open\r\ncreated: 2026-10-09T18:42:11Z\r\n---\r\nBody';
    expect(value(parseNote(text))).toMatchObject({ id: 'x', body: 'Body' });
  });

  it('reads an empty body at end of file', () => {
    const text = '---\nid: x\nschema: 1\nstatus: open\ncreated: 2026-10-09T18:42:11Z\n---';
    expect(value(parseNote(text)).body).toBe('');
  });
});

/** Frontmatter as a YAML 1.1 parser (PyYAML and others) would read it. */
function readAsYaml11(text: string): unknown {
  return parse(text.slice(4, text.indexOf('\n---\n')), { schema: 'yaml-1.1' });
}

const ambiguous = {
  created: '2026-10-09T18:42:11.204Z',
  date: '2026-10-09',
  yes: 'yes',
  off: 'off',
  octal: '0777',
  sexagesimal: '1:20',
  float: '1_000.5',
  tilde: '~',
};

describe('YAML 1.1 compatibility', () => {
  it.each(validNotes)('%s reads the same in a YAML 1.1 parser', (_, note) => {
    const { body: _body, ...fields } = note;
    expect(readAsYaml11(serializeNote(note))).toEqual(fields);
  });

  it('quotes strings a YAML 1.1 parser would read as another type', () => {
    const note = { ...minimal, ...ambiguous };
    const { body: _body, ...fields } = note;
    expect(readAsYaml11(serializeNote(note))).toEqual(fields);
    expect(value(parseNote(serializeNote(note)))).toEqual(note);
  });

  it('updateNote quotes ambiguous patch values', () => {
    const text = value(
      updateNote(serializeNote(minimal), { resolution: 'yes', tags: ['on', '2026-10-09', 'ui'] }),
    );
    expect(readAsYaml11(text)).toMatchObject({
      resolution: 'yes',
      tags: ['on', '2026-10-09', 'ui'],
    });
    expect(text).toContain('tags:\n  - "on"\n  - "2026-10-09"\n  - ui\n');
  });
});

/** Nested aliases that would expand to millions of nodes. */
function aliasBomb(): string {
  const refs = (name: string) => `[${Array(10).fill(`*${name}`).join(',')}]`;
  return [
    'a: &a [x,x,x,x,x,x,x,x,x,x]',
    `b: &b ${refs('a')}`,
    `c: &c ${refs('b')}`,
    `d: ${refs('c')}`,
  ].join('\n');
}

describe('parseNote errors', () => {
  it.each([
    ['no frontmatter', 'Just text'],
    ['an unclosed block', '---\nid: x\n'],
    ['empty input', ''],
  ])('reports missing-frontmatter for %s', (_, text) => {
    expect(errorCode(parseNote(text))).toBe('missing-frontmatter');
  });

  it.each([
    ['broken syntax', 'id: [1,'],
    ['duplicate keys', 'id: a\nid: b'],
    ['bad indentation', 'id: a\n  - b\n c: d'],
    ['an alias bomb', aliasBomb()],
  ])('reports invalid-yaml for %s', (_, frontmatter) => {
    const result = parseNote(`---\n${frontmatter}\n---\n`);
    expect(errorCode(result)).toBe('invalid-yaml');
  });

  it.each([
    ['a list', '- a\n- b'],
    ['a scalar', 'hello'],
    ['nothing', ''],
  ])('reports invalid-note for frontmatter that is %s', (_, frontmatter) => {
    expect(errorCode(parseNote(`---\n${frontmatter}\n---\n`))).toBe('invalid-note');
  });

  it('lists schema issues by path', () => {
    const text = serializeNote({ ...minimal, status: 'done' as Note['status'] });
    const result = parseNote(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid-note');
      expect(result.error.issues.map((issue) => issue.path)).toEqual(['status']);
      expect(result.error.message).toContain('status');
      expect(result.error).toBeInstanceOf(Error);
    }
  });

  it('ignores __proto__ keys without polluting anything', () => {
    const text = `---\n__proto__: { polluted: true, status: resolved }\nid: x\nschema: 1\nstatus: open\ncreated: 2026-10-09T18:42:11Z\n---\n`;
    const note = value(parseNote(text));
    expect(Object.getPrototypeOf(note)).toBe(Object.prototype);
    expect('polluted' in note).toBe(false);
    expect(note.status).toBe('open');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('never throws on arbitrary input', () => {
    const samples = ['---', '---\n---', '---\n:\n---', '---\n!!js/function x\n---', '\0\0\0'];
    for (const text of samples) expect(() => parseNote(text)).not.toThrow();
  });
});

describe('updateNote', () => {
  const original = [
    '---',
    '# written by hand',
    'id: 01JA8X3Q7K2M9V5T0N4R6P8W1Y # keep me',
    'schema: 1',
    'status: open',
    'created: 2026-10-09T18:42:11.204Z',
    'custom: { a: 1 }',
    'tags: [ui]',
    '---',
    '',
    'Body.',
    '',
    '## Notes',
    '',
    'Earlier note.',
    '',
  ].join('\n');

  it('changes status, resolution and tags and nothing else', () => {
    const updated = value(
      updateNote(original, { status: 'resolved', resolution: 'Fixed', tags: ['ui', 'done'] }),
    );
    expect(updated).toContain('# written by hand');
    expect(updated).toContain('# keep me');
    expect(updated).toContain('custom: { a: 1 }');
    expect(updated.slice(updated.indexOf('\n---\n'))).toBe(
      original.slice(original.indexOf('\n---\n')),
    );
    expect(value(parseNote(updated))).toMatchObject({
      status: 'resolved',
      resolution: 'Fixed',
      tags: ['ui', 'done'],
      custom: { a: 1 },
    });
  });

  it('keeps CRLF line endings and a BOM', () => {
    const crlf = `\uFEFF${original.replace(/\n/g, '\r\n')}`;
    const updated = value(updateNote(crlf, { status: 'resolved', tags: ['a'] }));
    expect(updated.startsWith('\uFEFF---\r\n')).toBe(true);
    expect(updated.replace(/\r\n/g, '')).not.toContain('\n');
    expect(value(parseNote(updated))).toMatchObject({ status: 'resolved', tags: ['a'] });
  });

  it('skips patch keys whose value is undefined', () => {
    const updated = value(updateNote(original, { status: 'resolved', resolution: undefined }));
    expect(updated).not.toContain('resolution');
  });

  it('leaves fields that are not in the patch alone', () => {
    const updated = value(updateNote(original, { resolution: null }));
    expect(value(parseNote(updated))).toMatchObject({ status: 'open', resolution: null });
  });

  it('rejects a patch that makes the note invalid', () => {
    expect(errorCode(updateNote(original, { status: 'done' as Note['status'] }))).toBe(
      'invalid-note',
    );
  });

  it('reports malformed files', () => {
    expect(errorCode(updateNote('no frontmatter', { status: 'resolved' }))).toBe(
      'missing-frontmatter',
    );
    expect(errorCode(updateNote('---\nid: [\n---\n', { status: 'resolved' }))).toBe('invalid-yaml');
  });
});

describe('appendToNotes', () => {
  const text = serializeNote(minimal);

  it('starts a ## Notes section at the end of the body', () => {
    const updated = value(appendToNotes(text, 'Checked on staging.'));
    expect(value(parseNote(updated)).body).toBe(
      'Button label is wrong.\n\n## Notes\n\nChecked on staging.\n',
    );
  });

  it('adds to an existing trailing ## Notes section', () => {
    const once = value(appendToNotes(text, 'First.'));
    const twice = value(appendToNotes(once, '  Second.  '));
    expect(value(parseNote(twice)).body).toBe(
      'Button label is wrong.\n\n## Notes\n\nFirst.\n\nSecond.\n',
    );
  });

  it('starts a new section when ## Notes is not the last heading', () => {
    const body = '## Notes\n\nmine\n\n## Other\n\nx\n';
    const updated = value(appendToNotes(serializeNote({ ...minimal, body }), 'Appended.'));
    expect(value(parseNote(updated)).body).toBe(`${body}\n## Notes\n\nAppended.\n`);
  });

  it('ignores ## Notes lines inside fenced code blocks', () => {
    const body = 'Steps:\n\n```md\n## Notes\n```\n\n~~~~\n## Notes\n```\n~~~~\n';
    const updated = value(appendToNotes(serializeNote({ ...minimal, body }), 'Real note.'));
    expect(value(parseNote(updated)).body).toBe(`${body}\n## Notes\n\nReal note.\n`);
  });

  it("uses the file's CRLF line endings", () => {
    const crlf = serializeNote({ ...minimal, body: 'Line one.\r\n' })
      .replace(/\n/g, '\r\n')
      .replace(/\r\r/g, '\r');
    const updated = value(appendToNotes(crlf, 'First.\nSecond line.'));
    expect(updated.replace(/\r\n/g, '')).not.toContain('\n');
    expect(updated.endsWith('Line one.\r\n\r\n## Notes\r\n\r\nFirst.\r\nSecond line.\r\n')).toBe(
      true,
    );
  });

  it('works on an empty body', () => {
    const updated = value(appendToNotes(serializeNote({ ...minimal, body: '' }), 'Only.'));
    expect(value(parseNote(updated)).body).toBe('## Notes\n\nOnly.\n');
  });

  it('keeps the frontmatter byte-for-byte', () => {
    const updated = value(appendToNotes(text, 'x'));
    const end = text.indexOf('\n---\n') + 5;
    expect(updated.slice(0, end)).toBe(text.slice(0, end));
  });

  it('refuses to touch an invalid file', () => {
    expect(errorCode(appendToNotes('nope', 'x'))).toBe('missing-frontmatter');
  });
});

describe('ulid', () => {
  it('is 26 Crockford base32 characters', () => {
    expect(ulid()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('encodes the timestamp so ids sort by time', () => {
    expect(ulid(0).slice(0, 10)).toBe('0000000000');
    expect(ulid(2 ** 48 - 1).slice(0, 10)).toBe('7ZZZZZZZZZ');
    expect(ulid(1_700_000_000_000).slice(0, 10)).toBe('01HF7YAT00');
    expect(ulid(1000) < ulid(2000)).toBe(true);
  });

  it('is random after the timestamp', () => {
    const ids = new Set(Array.from({ length: 100 }, () => ulid(0)));
    expect(ids.size).toBe(100);
  });

  it.each([-1, 2 ** 48, 1.5, Number.NaN])('rejects timestamp %s', (now) => {
    expect(() => ulid(now)).toThrow(RangeError);
  });
});

describe('noteDirName', () => {
  it('combines the id with a slug of the first line', () => {
    expect(noteDirName({ id: '01JA8X', body: '\n  \nCheckout button misaligned\nmore' })).toBe(
      '01JA8X-checkout-button-misaligned',
    );
  });

  it('is not unique: writers must create directories exclusively', () => {
    expect(noteDirName({ id: 'a/b', body: 'x' })).toBe(noteDirName({ id: 'a_b', body: 'x' }));
  });

  it('falls back to "note" for an empty body', () => {
    expect(noteDirName({ id: 'a', body: '' })).toBe('a-note');
  });

  it.each(['../../etc', 'a/b', 'a\\b', '..', '.', 'C:\\x', '\0', 'x'.repeat(200)])(
    'is a single safe segment for id %j',
    (id) => {
      const name = noteDirName({ id, body: '../../passwd' });
      expect(name).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(name.length).toBeLessThanOrEqual(64 + 1 + 48);
    },
  );
});
