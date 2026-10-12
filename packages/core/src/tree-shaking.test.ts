import { gzipSync } from 'node:zlib';
import { build, type Rolldown } from 'vite';
import { describe, expect, it } from 'vitest';

const core = new URL('index.ts', import.meta.url).pathname;
// The `@field-notes/core/note` subpath.
const noteEntry = new URL('note.ts', import.meta.url).pathname;

/** Minified, gzipped size of a bundle that imports `names` from `from`. */
async function bundle(names: string[], from = core): Promise<{ code: string; gzip: number }> {
  const output = (await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'entry',
        resolveId: (id) => (id === 'entry' ? id : undefined),
        load: (id) =>
          id === 'entry'
            ? `import { ${names.join(', ')} } from ${JSON.stringify(from)};\nconsole.log(${names.join(', ')});`
            : undefined,
      },
    ],
    build: { write: false, minify: true, rolldownOptions: { input: 'entry' } },
  })) as Rolldown.RolldownOutput[] | Rolldown.RolldownOutput;
  const [result] = Array.isArray(output) ? output : [output];
  const code =
    result?.output.map((chunk) => (chunk.type === 'chunk' ? chunk.code : '')).join('') ?? '';
  return { code, gzip: gzipSync(code).length };
}

describe('tree-shaking', () => {
  it('importing slugify alone leaves the schema and zod out', async () => {
    const { code, gzip } = await bundle(['slugify']);
    expect(code.includes('_zod'), 'zod is in the bundle').toBe(false);
    expect(gzip).toBeLessThan(400);
  });

  it('the note subpath brings the schema without yaml or fflate', async () => {
    const { code } = await bundle(['NoteSchema'], noteEntry);
    expect(code.includes('_zod'), 'zod is missing').toBe(true);
    expect(/YAMLParseError|yaml-1\.1/.test(code), 'yaml is in the bundle').toBe(false);
    expect(/invalid zip data|unzipSync|zipSync/.test(code), 'fflate is in the bundle').toBe(false);
  });

  it('those markers do appear when yaml and fflate are bundled', async () => {
    const { code } = await bundle(['serializeNote', 'readBundle']);
    expect(/YAMLParseError|yaml-1\.1/.test(code)).toBe(true);
    expect(/invalid zip data|unzipSync|zipSync/.test(code)).toBe(true);
  });
});
