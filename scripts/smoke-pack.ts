// Packs the published package, installs the tarball into a throwaway consumer
// project outside the workspace, and checks it works the way a user gets it.
// Catches what publint/attw can miss: leaked workspace imports, runtime
// dependencies, a broken bin, or types that don't resolve for consumers.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pkgDir = join(root, 'packages/field-notes');
interface PackageJson {
  name: string;
  version: string;
  exports: Record<string, unknown>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

const readJson = (path: string): PackageJson =>
  JSON.parse(readFileSync(path, 'utf8')) as PackageJson;
const pkg = readJson(join(pkgDir, 'package.json'));
const tsc = join(root, 'node_modules/typescript/bin/tsc');
const work = mkdtempSync(join(tmpdir(), 'field-notes-smoke-'));

const run = (cmd: string, args: string[], cwd: string): string =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8' }).trim();
// Use the pnpm that launched this script (the pinned version), not whatever is on PATH.
// npm_execpath is either a JS entry point or a standalone executable.
const execPath = process.env.npm_execpath ?? '';
const pnpm = (args: string[], cwd: string): string => {
  if (!execPath.includes('pnpm')) return run('pnpm', args, cwd);
  if (/\.[cm]?js$/.test(execPath)) return run(process.execPath, [execPath, ...args], cwd);
  return run(execPath, args, cwd);
};

function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    const {
      stdout = '',
      stderr = '',
      message,
    } = error as Error & { stdout?: string; stderr?: string };
    console.error(`  ✗ ${name}\n${stdout}${stderr}${message}`);
    process.exitCode = 1;
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

try {
  console.log(`smoke: ${pkg.name}@${pkg.version} in ${work}`);
  pnpm(['pack', '--pack-destination', work], pkgDir);
  const tarball = readdirSync(work).find((file) => file.endsWith('.tgz'));
  assert(tarball, 'pnpm pack produced no tarball');

  const consumer = join(work, 'consumer');
  mkdirSync(consumer);
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify({ name: 'consumer', private: true, type: 'module' }),
  );
  run('npm', ['install', '--no-audit', '--no-fund', '--silent', join(work, tarball)], consumer);
  const installed = join(consumer, 'node_modules', pkg.name);

  check('published package.json has zero runtime dependencies', () => {
    const published = readJson(join(installed, 'package.json'));
    const fields = ['dependencies', 'peerDependencies', 'optionalDependencies'] as const;
    for (const field of fields) {
      const names = Object.keys(published[field] ?? {});
      assert(names.length === 0, `${field} is not empty: ${names.join(', ')}`);
    }
  });

  check('README and LICENSE are included', () => {
    for (const file of ['README.md', 'LICENSE']) {
      assert(readdirSync(installed).includes(file), `${file} missing from the package`);
    }
  });

  check('no workspace specifiers leak into dist', () => {
    const dist = join(installed, 'dist');
    const leaks = readdirSync(dist, { recursive: true, encoding: 'utf8' })
      .filter((file) => /\.(js|d\.ts)$/.test(file))
      .filter((file) => readFileSync(join(dist, file), 'utf8').includes('@field-notes/'));
    assert(leaks.length === 0, `found @field-notes/ in: ${leaks.join(', ')}`);
  });

  check('every subpath export imports in Node', () => {
    const subpaths = Object.keys(pkg.exports).filter((key) => !key.endsWith('package.json'));
    for (const subpath of subpaths) {
      const specifier = subpath === '.' ? pkg.name : `${pkg.name}/${subpath.slice(2)}`;
      run(
        'node',
        ['--input-type=module', '-e', `await import(${JSON.stringify(specifier)})`],
        consumer,
      );
    }
  });

  check('bin runs and reports the package version', () => {
    const version = run(join(consumer, 'node_modules/.bin/field-notes'), ['--version'], consumer);
    assert(version === pkg.version, `expected ${pkg.version}, got ${version}`);
  });

  check('types resolve for a TypeScript consumer (nodenext)', () => {
    writeFileSync(
      join(consumer, 'consumer.ts'),
      [
        `import { TAG_NAME, isEditableTarget, mountFieldNotes, type FieldNotesHandle } from '${pkg.name}';`,
        `import { isAllowedOrigin } from '${pkg.name}/sink';`,
        `const tag: string = TAG_NAME;`,
        `const editable: boolean = isEditableTarget(null);`,
        `const handle: FieldNotesHandle = mountFieldNotes({ enabled: () => false });`,
        `const opened: Promise<void> = handle.open();`,
        `const allowed: boolean = isAllowedOrigin('http://localhost:1', []);`,
        `export { tag, editable, allowed, opened };`,
      ].join('\n'),
    );
    writeFileSync(
      join(consumer, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          module: 'nodenext',
          moduleResolution: 'nodenext',
          target: 'es2022',
          lib: ['es2023', 'dom'],
          types: [],
        },
        files: ['consumer.ts'],
      }),
    );
    run('node', [tsc, '-p', 'tsconfig.json'], consumer);
  });
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (process.exitCode) console.error('smoke: FAILED');
else console.log('smoke: ok');
