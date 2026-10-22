// Publishes the tarballs `changeset pack` made, in the Release workflow's
// publish job: the one job that holds the OIDC token npm trusts. It installs
// and builds nothing, and has no dependencies, so only pnpm and this script
// run with that token. For each package in the pack's publish-plan.json, it
// checks the tarball is the one planned, publishes it unless that version is
// on npm already, then tags the commit and makes the GitHub release as
// changesets does (`<name>@<version>`, notes from CHANGELOG.md). Each step is
// skipped when done, so a rerun picks up where a failed run stopped.
//
// The pack artifact is checked against this job's checkout, not trusted: the
// name and version must be the checked-out package's, the package can't be
// private, and the dist-tag must be one changesets would pick from the
// checkout. pnpm runs without GITHUB_TOKEN.
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
  /** The environment to run commands in, before GITHUB_TOKEN is taken out. */
  readonly env: Env;
  /** Runs a command in exactly `env`, resolving to its stdout; rejects if it fails. */
  readonly exec: (command: string, args: readonly string[], env: Env) => Promise<string>;
  readonly fetch: typeof fetch;
  readonly log: (line: string) => void;
}

export type Env = Readonly<Record<string, string | undefined>>;

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

interface Manifest {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly private?: unknown;
}

/** The workspace package called `name`, under `<root>/packages`. */
async function checkedOut(
  root: string,
  name: string,
): Promise<{ dir: string; manifest: Manifest }> {
  for (const entry of await readdir(join(root, 'packages'))) {
    const dir = join(root, 'packages', entry);
    let manifest: Manifest;
    try {
      manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as Manifest;
    } catch {
      continue; // not a package
    }
    if (manifest.name === name) return { dir, manifest };
  }
  return fail(`${name}: no package with that name under packages/`);
}

/**
 * The dist-tags changesets could give a release in this checkout: `latest`,
 * and while `.changeset/pre.json` exists its tag too (changesets still uses
 * `latest` for a package with only prereleases on npm).
 */
export async function allowedTags(root: string): Promise<string[]> {
  let json: string;
  try {
    json = await readFile(join(root, '.changeset', 'pre.json'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ['latest'];
    throw error;
  }
  const { tag } = JSON.parse(json) as { tag?: unknown };
  if (typeof tag !== 'string' || !DIST_TAG.test(tag)) fail('.changeset/pre.json: bad tag');
  return ['latest', tag];
}

/** `env` without GITHUB_TOKEN: the commands run here need none of it. */
export function withoutGitHubToken(env: Env): Env {
  const { GITHUB_TOKEN: _, ...rest } = env;
  return rest;
}

/** Runs `command` in exactly `env`, resolving to its stdout. */
export async function execIn(command: string, args: readonly string[], env: Env): Promise<string> {
  const { stdout } = await promisify(execFile)(command, args, {
    env,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
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

  const childEnv = withoutGitHubToken(options.env);
  const run = (command: string, args: readonly string[]) => exec(command, args, childEnv);
  const releases = readPlan(await readFile(join(options.packDir, 'publish-plan.json'), 'utf8'));
  if (releases.length === 0) log('Nothing to publish.');
  const tags = await allowedTags(options.root);
  for (const release of releases) {
    const label = `${release.name}@${release.version}`;
    const file = join(options.packDir, release.tarball.path);

    // The plan comes from the pack job, so it's checked against this checkout.
    const { dir, manifest: local } = await checkedOut(options.root, release.name);
    if (local.private === true) fail(`${label}: the checked-out package is private`);
    if (local.version !== release.version) {
      fail(`${label}: the checked-out package is at ${String(local.version)}`);
    }
    if (!tags.includes(release.tag)) {
      fail(`${label}: dist-tag ${release.tag} isn't one of ${tags.join(', ')}`);
    }

    // The tarball is the one planned: its bytes, then the manifest inside.
    const digest = `sha256-${createHash('sha256')
      .update(await readFile(file))
      .digest('base64')}`;
    if (digest !== release.tarball.integrity) fail(`${label}: tarball integrity doesn't match`);
    const manifest = JSON.parse(
      await run('tar', ['-xzOf', file, 'package/package.json']),
    ) as Manifest;
    if (manifest.name !== release.name || manifest.version !== release.version) {
      fail(`${label}: the tarball holds ${String(manifest.name)}@${String(manifest.version)}`);
    }
    // Before publishing, so a missing entry stops the release, not just its notes.
    const changelog = await readFile(join(dir, 'CHANGELOG.md'), 'utf8').catch(() => '');
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
        await run('pnpm', [
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
      env: process.env,
      exec: execIn,
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
