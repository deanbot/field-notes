import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NoteFrontmatterSchema, NoteSchema, isAttachmentName, noteJsonSchema } from './index.ts';

const fixtures = new URL('../../../spec/fixtures/', import.meta.url);

function load(kind: 'valid' | 'invalid'): [string, unknown][] {
  const dir = new URL(`${kind}/`, fixtures);
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => [file, JSON.parse(readFileSync(new URL(file, dir), 'utf8')) as unknown]);
}

describe('NoteSchema fixtures', () => {
  it.each(load('valid'))('accepts valid/%s unchanged', (_, data) => {
    expect(NoteSchema.parse(data)).toEqual(data);
  });

  // The field each invalid fixture is wrong about, so none can fail for another reason.
  const failingField: Record<string, string> = {
    'context-not-object.json': 'context',
    'created-not-iso.json': 'created',
    'element-without-selector.json': 'element.selector',
    'empty-id.json': 'id',
    'empty-type.json': 'type',
    'future-schema.json': 'schema',
    'missing-body.json': 'body',
    'missing-created.json': 'created',
    'missing-id.json': 'id',
    'screenshot-control-char.json': 'screenshot',
    'screenshot-dotfile.json': 'screenshot',
    'screenshot-drive-relative.json': 'screenshot',
    'screenshot-subdir.json': 'screenshot',
    'screenshot-traversal.json': 'screenshot',
    'tags-not-array.json': 'tags',
    'unknown-status.json': 'status',
  };

  it.each(load('invalid'))('rejects invalid/%s for the right field', (file, data) => {
    const result = NoteSchema.safeParse(data);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual([failingField[file]]);
  });
});

describe('NoteSchema', () => {
  const minimal = {
    id: '01JA8X3Q7K2M9V5T0N4R6P8W1Y',
    schema: 1,
    status: 'open',
    created: '2026-10-09T18:42:11.204Z',
    body: '',
  };

  it('keeps unknown fields at every level', () => {
    const data = {
      ...minimal,
      extra: { nested: [1, 2] },
      element: { selector: '#a', extra: true, rect: { x: 0, y: 0, w: 1, h: 1, extra: 'r' } },
      viewport: { width: 1, height: 1, extra: 'v' },
    };
    expect(NoteSchema.parse(data)).toEqual(data);
  });

  it('accepts any non-empty type', () => {
    expect(NoteSchema.parse({ ...minimal, type: 'anything at all' }).type).toBe('anything at all');
  });

  it('reports the failing path', () => {
    const result = NoteSchema.safeParse({ ...minimal, element: { selector: 1 } });
    expect(result.error?.issues[0]?.path).toEqual(['element', 'selector']);
  });
});

describe('isAttachmentName', () => {
  it.each(['screenshot.png', 'shot-2_final.v2.webp', 'a', 'x'.repeat(128)])('allows %j', (name) => {
    expect(isAttachmentName(name)).toBe(true);
  });

  it.each([
    '',
    '.',
    '..',
    '.hidden',
    '../x',
    'a/b',
    'a\\b',
    'C:evil.png',
    'a:b',
    ' ',
    'x\n',
    'é.png',
    'x'.repeat(129),
  ])('rejects %j', (name) => {
    expect(isAttachmentName(name)).toBe(false);
  });
});

describe('NoteFrontmatterSchema', () => {
  it('does not require a body', () => {
    const { body, ...frontmatter } = JSON.parse(
      readFileSync(new URL('valid/full.json', fixtures), 'utf8'),
    ) as Record<string, unknown>;
    expect(NoteFrontmatterSchema.safeParse(frontmatter).success).toBe(true);
  });
});

describe('spec/note.schema.json', () => {
  it('matches the schema (regenerate with `pnpm test -u`)', async () => {
    await expect(`${JSON.stringify(noteJsonSchema(), null, 2)}\n`).toMatchFileSnapshot(
      '../../../spec/note.schema.json',
    );
  });

  it('allows unknown fields', () => {
    expect(noteJsonSchema()).toMatchObject({ additionalProperties: {} });
  });
});
