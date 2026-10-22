// Publishes the tarballs `changeset pack` made, in the Release workflow's
// publish job: the one job that holds the OIDC token npm trusts. It installs
// and builds nothing, and has no dependencies, so only pnpm and this script
// run with that token. For each package in the pack's publish-plan.json, it
// checks the tarball is the one planned, publishes it unless that version is
// on npm already, then tags the commit and makes the GitHub release as
// changesets does (`<name>@<version>`, notes from CHANGELOG.md). Each step is
// skipped when done, so a rerun picks up where a failed run stopped.
//
//   node scripts/publish-packed.ts <pack-dir> [--dry-run]
//
// --dry-run checks everything, runs `pnpm publish --dry-run`, and only says
// what it would tag and release.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

export interface Release {
  readonly name: string;
  readonly version: string;
  readonly access: string;
  readonly tag: string;
  readonly tarball: { readonly path: string; readonly integrity: string };
}

export interface PublishOptions {
  /** The directory `changeset pack --out-dir` wrote. */
  readonly packDir: string;
  /** The repository root, whose packages hold each CHANGELOG.md. */
  readonly root: string;
  /** `owner/name`, and the commit to tag. */
  readonly repo: string;
  readonly sha: string;
  readonly token: string;
  readonly dryRun: boolean;
  /** Runs a command, resolving to its stdout; rejects if it fails. */
  readonly exec: (command: string, args: readonly string[]) => Promise<string>;
  readonly fetch: typeof fetch;
  readonly log: (line: string) => void;
}

const NAME = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const DIST_TAG = /^[a-z][\w.-]*$/i;
const TARBALL = /^packages\/[\w@.-]+\.tgz$/;

function fail(message: string): never {
  throw new Error(message);
}

/** The publish releases in a pack's publish-plan.json, checked field by field. */
export function readPlan(json: string): Release[] {
  const file = JSON.parse(json) as { version?: unknown; plan?: unknown };
  if (file.version !== 1 || !Array.isArray(file.plan)) fail('publish-plan.json: not version 1');
  return (file.plan as unknown[]).flat().map((entry) => {
    const release = entry as Partial<Release> & { kind?: unknown };
    const label = `${String(release.name)}@${String(release.version)}`;
    if (release.kind !== 'publish') fail(`${label}: can't handle kind ${String(release.kind)}`);
    if (typeof release.name !== 'string' || !NAME.test(release.name)) fail(`${label}: bad name`);
    if (typeof release.version !== 'string' || !VERSION.test(release.version)) {
      fail(`${label}: bad version`);
    }
    if (release.access !== 'public' && release.access !== 'restricted') {
      fail(`${label}: bad access`);
    }
    if (typeof release.tag !== 'string' || !DIST_TAG.test(release.tag)) fail(`${label}: bad tag`);
    const { path, integrity } = release.tarball ?? {};
    if (typeof path !== 'string' || !TARBALL.test(path) || path.includes('..')) {
      fail(`${label}: bad tarball path`);
    }
    if (typeof integrity !== 'string' || !integrity.startsWith('sha256-')) {
      fail(`${label}: bad integrity`);
    }
    return release as Release;
  });
}

/** The notes under `## <version>` in a CHANGELOG, as changesets puts them in a release. */
export function changelogSection(changelog: string, version: string): string | undefined {
  const lines = changelog.split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (start === -1) return undefined;
  const end = lines.findIndex((line, i) => i > start && /^#{1,2} /.test(line));
  const section = lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join('\n')
    .trim();
  return section || undefined;
}

/** The directory of the workspace package called `name`, under `<root>/packages`. */
async function packageDir(root: string, name: string): Promise<string> {
  for (const entry of await readdir(join(root, 'packages'))) {
    const dir = join(root, 'packages', entry);
    try {
      const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as {
        name?: unknown;
      };
      if (manifest.name === name) return dir;
    } catch {
      // not a package
    }
  }
  return fail(`${name}: no package with that name under packages/`);
}

export async function publishPacked(options: PublishOptions): Promise<void> {
  const { exec, log } = options;
  const github = async (method: 'GET' | 'POST', path: string, body?: unknown) =>
    options.fetch(`https://api.github.com/repos/${options.repo}/${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${options.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  /** Whether a GET found the thing (200) or not (404); anything else is an error. */
  const found = (response: Response, what: string): boolean => {
    if (response.status === 200) return true;
    if (response.status === 404) return false;
    return fail(`${what}: HTTP ${String(response.status)}`);
  };
  const created = async (response: Response, what: string): Promise<void> => {
    if (response.status !== 201) {
      fail(`${what}: HTTP ${String(response.status)} ${await response.text()}`);
    }
  };

  const releases = readPlan(await readFile(join(options.packDir, 'publish-plan.json'), 'utf8'));
  if (releases.length === 0) log('Nothing to publish.');
  for (const release of releases) {
    const label = `${release.name}@${release.version}`;
    const file = join(options.packDir, release.tarball.path);

    // The tarball is the one planned: its bytes, then the manifest inside.
    const digest = `sha256-${createHash('sha256')
      .update(await readFile(file))
      .digest('base64')}`;
    if (digest !== release.tarball.integrity) fail(`${label}: tarball integrity doesn't match`);
    const manifest = JSON.parse(await exec('tar', ['-xzOf', file, 'package/package.json'])) as {
      name?: unknown;
      version?: unknown;
    };
    if (manifest.name !== release.name || manifest.version !== release.version) {
      fail(`${label}: the tarball holds ${String(manifest.name)}@${String(manifest.version)}`);
    }
    // Before publishing, so a missing entry stops the release, not just its notes.
    const changelog = await readFile(
      join(await packageDir(options.root, release.name), 'CHANGELOG.md'),
      'utf8',
    ).catch(() => '');
    const notes = changelogSection(changelog, release.version);
    if (notes === undefined) fail(`${label}: no CHANGELOG.md entry for ${release.version}`);

    const onNpm = found(
      await options.fetch(
        `https://registry.npmjs.org/${release.name.replace('/', '%2F')}/${release.version}`,
      ),
      `${label}: npm lookup`,
    );
    if (onNpm) log(`${label} is on npm already; not publishing it again.`);
    else {
      log(
        await exec('pnpm', [
          'publish',
          file,
          '--access',
          release.access,
          '--tag',
          release.tag,
          '--no-git-checks',
          '--ignore-scripts',
          ...(options.dryRun ? ['--dry-run'] : []),
        ]),
      );
    }

    if (options.dryRun) {
      log(
        `Would tag ${options.sha} as ${label} and release it, with ${String(notes.length)} characters of notes.`,
      );
      continue;
    }
    const ref = `tags/${label}`;
    if (found(await github('GET', `git/ref/${ref}`), `${label}: tag lookup`)) {
      log(`Tag ${label} exists already.`);
    } else {
      await created(
        await github('POST', 'git/refs', { ref: `refs/${ref}`, sha: options.sha }),
        `${label}: tagging`,
      );
      log(`Tagged ${options.sha} as ${label}.`);
    }
    if (
      found(
        await github('GET', `releases/tags/${encodeURIComponent(label)}`),
        `${label}: release lookup`,
      )
    ) {
      log(`Release ${label} exists already.`);
    } else {
      await created(
        await github('POST', 'releases', {
          tag_name: label,
          name: label,
          body: notes,
          prerelease: release.version.includes('-'),
        }),
        `${label}: releasing`,
      );
      log(`Released ${label}.`);
    }
  }
}

if (process.argv[1] === import.meta.filename) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const [packDir] = args.filter((arg) => arg !== '--dry-run');
  const env = (name: string): string =>
    process.env[name] ?? (dryRun ? '' : fail(`${name} isn't set`));
  try {
    if (!packDir) fail('usage: node scripts/publish-packed.ts <pack-dir> [--dry-run]');
    await publishPacked({
      packDir: resolve(packDir),
      root: resolve(import.meta.dirname, '..'),
      repo: env('GITHUB_REPOSITORY'),
      sha: env('GITHUB_SHA'),
      token: env('GITHUB_TOKEN'),
      dryRun,
      exec: async (command, argv) =>
        (await promisify(execFile)(command, argv, { maxBuffer: 64 * 1024 * 1024 })).stdout,
      fetch,
      log: (line) => {
        console.log(line);
      },
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
