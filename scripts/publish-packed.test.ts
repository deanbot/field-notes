import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  changelogSection,
  type PublishOptions,
  publishPacked,
  readPlan,
} from './publish-packed.ts';

const run = promisify(execFile);
const NAME = '@scope/pkg';
const SHA = 'a'.repeat(40);
const CHANGELOG = `# ${NAME}

## 1.0.1

### Patch Changes

- abc1234: Fixed a thing.

  More about it.

## 1.0.0

### Major Changes

- def5678: First release.
`;

let work: string;
let root: string;
let packDir: string;

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'field-notes-publish-packed-'));
  root = join(work, 'repo');
  packDir = join(work, 'pack');
  await mkdir(join(root, 'packages', 'pkg'), { recursive: true });
  await mkdir(join(root, 'packages', 'other'), { recursive: true });
  await writeFile(join(root, 'packages', 'other', 'package.json'), '{"name":"other"}');
  await writeFile(join(root, 'packages', 'pkg', 'package.json'), JSON.stringify({ name: NAME }));
  await writeFile(join(root, 'packages', 'pkg', 'CHANGELOG.md'), CHANGELOG);
  await mkdir(join(packDir, 'packages'), { recursive: true });
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

/** Packs a tarball holding `manifest`, and writes a plan for `planned`. */
async function pack(
  planned: { name?: string; version?: string; [key: string]: unknown } = {},
  manifest: { name: string; version: string } = { name: NAME, version: '1.0.1' },
): Promise<string> {
  const src = join(work, 'src', 'package');
  await mkdir(src, { recursive: true });
  await writeFile(join(src, 'package.json'), JSON.stringify(manifest));
  const path = 'packages/scope-pkg-1.0.1.tgz';
  await run('tar', ['-czf', join(packDir, path), '-C', join(work, 'src'), 'package']);
  const integrity = `sha256-${createHash('sha256')
    .update(await readFile(join(packDir, path)))
    .digest('base64')}`;
  const release = {
    kind: 'publish',
    name: NAME,
    version: '1.0.1',
    access: 'public',
    tag: 'latest',
    tarball: { path, integrity },
    ...planned,
  };
  await writeFile(
    join(packDir, 'publish-plan.json'),
    JSON.stringify({ version: 1, plan: [[release]] }),
  );
  return join(packDir, path);
}

/** A fetch that answers every request with `answer`. */
function fakeFetch(answer: (url: string, init?: RequestInit) => Response): typeof fetch {
  return (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return Promise.resolve(answer(url, init));
  };
}

interface World {
  readonly onNpm?: number;
  readonly tag?: number;
  readonly release?: number;
  readonly post?: number;
}

/** Options with a fake npm and GitHub, and every call they get. */
function setUp(world: World = {}, dryRun = false) {
  const calls: { pnpm: string[][]; posts: { path: string; body: unknown }[]; log: string[] } = {
    pnpm: [],
    posts: [],
    log: [],
  };
  const options: PublishOptions = {
    packDir,
    root,
    repo: 'owner/repo',
    sha: SHA,
    token: 't0ken',
    dryRun,
    exec: async (command, args) => {
      if (command === 'pnpm') {
        calls.pnpm.push([...args]);
        return 'published';
      }
      return (await run(command, [...args])).stdout;
    },
    fetch: fakeFetch((url, init) => {
      if (url.startsWith('https://registry.npmjs.org/')) {
        expect(url).toBe('https://registry.npmjs.org/@scope%2Fpkg/1.0.1');
        return new Response('', { status: world.onNpm ?? 404 });
      }
      const path = url.replace('https://api.github.com/repos/owner/repo/', '');
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer t0ken' });
      if (init?.method === 'POST') {
        calls.posts.push({ path, body: JSON.parse(init.body as string) });
        return new Response('{}', { status: world.post ?? 201 });
      }
      if (path === `git/ref/tags/${NAME}@1.0.1`)
        return new Response('', { status: world.tag ?? 404 });
      if (path === `releases/tags/${encodeURIComponent(`${NAME}@1.0.1`)}`) {
        return new Response('', { status: world.release ?? 404 });
      }
      throw new Error(`unexpected request: ${url}`);
    }),
    log: (line) => {
      calls.log.push(line);
    },
  };
  return { options, calls };
}

describe('publishPacked', () => {
  it('publishes the tarball, then tags the commit and releases it as changesets does', async () => {
    const file = await pack();
    const { options, calls } = setUp();
    await publishPacked(options);
    expect(calls.pnpm).toEqual([
      [
        'publish',
        file,
        '--access',
        'public',
        '--tag',
        'latest',
        '--no-git-checks',
        '--ignore-scripts',
      ],
    ]);
    expect(calls.posts).toEqual([
      { path: 'git/refs', body: { ref: `refs/tags/${NAME}@1.0.1`, sha: SHA } },
      {
        path: 'releases',
        body: {
          tag_name: `${NAME}@1.0.1`,
          name: `${NAME}@1.0.1`,
          body: '### Patch Changes\n\n- abc1234: Fixed a thing.\n\n  More about it.',
          prerelease: false,
        },
      },
    ]);
  });

  it('on a rerun, skips what is done: the publish, the tag and the release', async () => {
    await pack();
    const { options, calls } = setUp({ onNpm: 200, tag: 200, release: 200 });
    await publishPacked(options);
    expect(calls.pnpm).toEqual([]);
    expect(calls.posts).toEqual([]);
    expect(calls.log).toContain(`${NAME}@1.0.1 is on npm already; not publishing it again.`);
  });

  it('tags and releases a version that a failed run published but never tagged', async () => {
    await pack();
    const { options, calls } = setUp({ onNpm: 200 });
    await publishPacked(options);
    expect(calls.pnpm).toEqual([]);
    expect(calls.posts.map((post) => post.path)).toEqual(['git/refs', 'releases']);
  });

  it('marks a prerelease as one', async () => {
    await pack({ version: '1.1.0-beta.1', tag: 'beta' }, { name: NAME, version: '1.1.0-beta.1' });
    await writeFile(
      join(root, 'packages', 'pkg', 'CHANGELOG.md'),
      CHANGELOG.replace('## 1.0.1', '## 1.1.0-beta.1'),
    );
    const { options, calls } = setUp();
    await publishPacked({
      ...options,
      fetch: fakeFetch((_, init) => {
        if (init?.method === 'POST') {
          calls.posts.push({ path: '', body: JSON.parse(init.body as string) });
          return new Response('{}', { status: 201 });
        }
        return new Response('', { status: 404 });
      }),
    });
    expect(calls.pnpm[0]).toContain('beta');
    expect(calls.posts[1]?.body).toMatchObject({ prerelease: true });
  });

  it('in a dry run, runs pnpm publish --dry-run and changes nothing on GitHub', async () => {
    const file = await pack();
    const { options, calls } = setUp({}, true);
    await publishPacked(options);
    expect(calls.pnpm).toEqual([
      [
        'publish',
        file,
        '--access',
        'public',
        '--tag',
        'latest',
        '--no-git-checks',
        '--ignore-scripts',
        '--dry-run',
      ],
    ]);
    expect(calls.posts).toEqual([]);
    expect(calls.log.at(-1)).toMatch(/^Would tag a{40} as @scope\/pkg@1\.0\.1 and release it/);
  });

  it('says so when there is nothing to publish', async () => {
    await writeFile(join(packDir, 'publish-plan.json'), '{"version":1,"plan":[]}');
    const { options, calls } = setUp();
    await publishPacked(options);
    expect(calls.log).toEqual(['Nothing to publish.']);
  });

  describe('refuses before publishing anything', () => {
    it.each([
      [
        'a tarball holding another version',
        {},
        { name: NAME, version: '1.0.0' },
        'the tarball holds @scope/pkg@1.0.0',
      ],
      [
        'a tarball holding another package',
        {},
        { name: 'evil', version: '1.0.1' },
        'the tarball holds evil@1.0.1',
      ],
    ])('%s', async (_, planned, manifest, error) => {
      await pack(planned, manifest);
      const { options, calls } = setUp();
      await expect(publishPacked(options)).rejects.toThrow(error);
      expect(calls.pnpm).toEqual([]);
    });

    it('a tarball whose bytes changed since it was packed', async () => {
      const file = await pack();
      await writeFile(file, Buffer.concat([await readFile(file), Buffer.from([0])]));
      const { options, calls } = setUp();
      await expect(publishPacked(options)).rejects.toThrow("tarball integrity doesn't match");
      expect(calls.pnpm).toEqual([]);
    });

    it('a version with no CHANGELOG.md entry', async () => {
      await pack();
      await writeFile(
        join(root, 'packages', 'pkg', 'CHANGELOG.md'),
        CHANGELOG.replace('## 1.0.1', '## 1.0.2'),
      );
      const { options, calls } = setUp();
      await expect(publishPacked(options)).rejects.toThrow('no CHANGELOG.md entry for 1.0.1');
      expect(calls.pnpm).toEqual([]);
    });

    it('a package not in the workspace', async () => {
      await rm(join(root, 'packages', 'pkg', 'package.json'));
      await pack();
      const { options } = setUp();
      await expect(publishPacked(options)).rejects.toThrow('no package with that name');
    });

    it('an npm lookup that neither finds nor misses the version', async () => {
      await pack();
      const { options, calls } = setUp({ onNpm: 500 });
      await expect(publishPacked(options)).rejects.toThrow('npm lookup: HTTP 500');
      expect(calls.pnpm).toEqual([]);
    });
  });

  it('fails when GitHub refuses the tag', async () => {
    await pack();
    const { options } = setUp({ post: 422 });
    await expect(publishPacked(options)).rejects.toThrow('tagging: HTTP 422');
  });
});

describe('readPlan', () => {
  const release = {
    kind: 'publish',
    name: NAME,
    version: '1.0.1',
    access: 'public',
    tag: 'latest',
    tarball: { path: 'packages/scope-pkg-1.0.1.tgz', integrity: 'sha256-x' },
  };
  const plan = (changes: Record<string, unknown>): string =>
    JSON.stringify({ version: 1, plan: [[{ ...release, ...changes }]] });

  it('reads the publish releases, in order', () => {
    const second = { ...release, name: 'b' };
    expect(readPlan(JSON.stringify({ version: 1, plan: [[release], [second]] }))).toEqual([
      release,
      second,
    ]);
  });

  it.each([
    ['another plan version', JSON.stringify({ version: 2, plan: [] }), 'not version 1'],
    ['a tag-only release', plan({ kind: 'tag-only' }), "can't handle kind tag-only"],
    ['a bad name', plan({ name: '../x' }), 'bad name'],
    ['a bad version', plan({ version: '1.0' }), 'bad version'],
    ['a bad access', plan({ access: 'everyone' }), 'bad access'],
    ['a dist-tag that is an option', plan({ tag: '--registry=x' }), 'bad tag'],
    [
      'a tarball outside packages/',
      plan({ tarball: { path: '../x.tgz', integrity: 'sha256-x' } }),
      'bad tarball path',
    ],
    [
      'a tarball path climbing out',
      plan({ tarball: { path: 'packages/...tgz', integrity: 'sha256-x' } }),
      'bad tarball path',
    ],
    [
      'a tarball in a subdirectory',
      plan({ tarball: { path: 'packages/a/b.tgz', integrity: 'sha256-x' } }),
      'bad tarball path',
    ],
    [
      'another hash',
      plan({ tarball: { path: 'packages/a.tgz', integrity: 'sha512-x' } }),
      'bad integrity',
    ],
  ])('refuses %s', (_, json, error) => {
    expect(() => readPlan(json)).toThrow(error);
  });
});

describe('changelogSection', () => {
  it('takes the lines under the version heading, up to the next', () => {
    expect(changelogSection(CHANGELOG, '1.0.0')).toBe(
      '### Major Changes\n\n- def5678: First release.',
    );
  });

  it("doesn't take a version that only starts the same", () => {
    expect(changelogSection(CHANGELOG.replace('## 1.0.1', '## 1.0.10'), '1.0.1')).toBeUndefined();
  });

  it('finds no notes in an empty section', () => {
    expect(changelogSection('## 1.0.1\n\n## 1.0.0\n- x', '1.0.1')).toBeUndefined();
  });

  it("matches the notes of the repository's own 1.0.0 release", async () => {
    const changelog = await readFile(
      join(import.meta.dirname, '..', 'packages', 'field-notes', 'CHANGELOG.md'),
      'utf8',
    );
    const notes = changelogSection(changelog, '1.0.0') ?? '';
    // The release changesets made on GitHub begins and ends so.
    expect(notes.startsWith('### Major Changes\n\n- f0e096d: First release.')).toBe(true);
    expect(
      notes.endsWith('They used to wait out the retry backoff, which can reach a minute.'),
    ).toBe(true);
  });
});
