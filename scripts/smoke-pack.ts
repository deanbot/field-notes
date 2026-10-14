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

  check('bin serves the sink, /health and the widget script with a token', () => {
    // A child script, since checks are synchronous: start `serve`, ask it, stop it.
    const probe = `
      import { spawn } from 'node:child_process';
      const serve = spawn(${JSON.stringify(join(consumer, 'node_modules/.bin/field-notes'))},
        ['serve', '--port', '0', '--dir', '.field-notes'], { stdio: ['ignore', 'pipe', 'inherit'] });
      try {
        const url = await new Promise((done, fail) => {
          let out = '';
          serve.stdout.on('data', (chunk) => {
            out += chunk;
            const found = /http:\\/\\/127\\.0\\.0\\.1:\\d+/.exec(out);
            if (found) done(found[0]);
          });
          serve.once('exit', () => fail(new Error('serve exited: ' + out)));
        });
        const health = await (await fetch(url + '/health')).json();
        const script = await (await fetch(url + '/widget.js')).text();
        console.log(JSON.stringify({ health, script: script.slice(0, 20), placeholder: script.includes('{{field-notes-token}}') }));
      } finally {
        serve.kill();
      }`;
    const result = JSON.parse(run('node', ['--input-type=module', '-e', probe], consumer)) as {
      health: { ok: boolean; version: string };
      script: string;
      placeholder: boolean;
    };
    assert(result.health.ok && result.health.version === pkg.version, '/health is wrong');
    assert(result.script.startsWith('var FieldNotes='), '/widget.js is not the script-tag build');
    assert(!result.placeholder, 'the token was not filled in');
  });

  check('bin tail exits cleanly when its reader stops reading', () => {
    // As `field-notes tail --json | head -1`: the next note it writes finds
    // the pipe closed, which ends it with 0, not an EPIPE stack trace.
    const probe = `
      import { spawn } from 'node:child_process';
      import { mkdirSync, writeFileSync } from 'node:fs';
      const note = (id) => {
        mkdirSync('.tail-notes/items/' + id, { recursive: true });
        writeFileSync('.tail-notes/items/' + id + '/note.md',
          '---\\nid: ' + id + '\\nschema: 1\\nstatus: open\\ncreated: ' + new Date().toISOString() + '\\n---\\nHi\\n');
      };
      note('A');
      const tail = spawn(${JSON.stringify(join(consumer, 'node_modules/.bin/field-notes'))},
        ['tail', '--json', '--since', '1d', '--dir', '.tail-notes'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let err = '';
      tail.stderr.on('data', (chunk) => { err += chunk; });
      const timer = setTimeout(() => tail.kill('SIGKILL'), 15000);
      tail.stdout.once('data', () => {
        tail.stdout.destroy();
        note('B');
      });
      const code = await new Promise((done) => tail.once('exit', (code) => done(code)));
      clearTimeout(timer);
      console.log(JSON.stringify({ code, err }));`;
    const result = JSON.parse(run('node', ['--input-type=module', '-e', probe], consumer)) as {
      code: number | null;
      err: string;
    };
    assert(result.code === 0, `tail exited with ${String(result.code)}: ${result.err}`);
    assert(!result.err.includes('EPIPE'), `tail reported EPIPE: ${result.err}`);
  });

  // Two compiles: the widget's types must not need Node's; the sink is a
  // Node API, so its consumers have them.
  const compile = (name: string, lines: string[], types: string[]): void => {
    writeFileSync(join(consumer, `${name}.ts`), lines.join('\n'));
    writeFileSync(
      join(consumer, `tsconfig.${name}.json`),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          module: 'nodenext',
          moduleResolution: 'nodenext',
          target: 'es2022',
          lib: ['es2023', 'dom'],
          typeRoots: [join(root, 'node_modules/@types')],
          types,
        },
        files: [`${name}.ts`],
      }),
    );
    run('node', [tsc, '-p', `tsconfig.${name}.json`], consumer);
  };

  check('types resolve for a TypeScript consumer (nodenext), without Node types', () => {
    compile(
      'consumer',
      [
        `import { TAG_NAME, isEditableTarget, mountFieldNotes, type FieldNotesHandle } from '${pkg.name}';`,
        `const tag: string = TAG_NAME;`,
        `const editable: boolean = isEditableTarget(null);`,
        `const handle: FieldNotesHandle = mountFieldNotes({ enabled: () => false });`,
        `const opened: Promise<void> = handle.open();`,
        `export { tag, editable, opened };`,
      ],
      [],
    );
  });

  check('sink types resolve for a Node consumer (nodenext)', () => {
    compile(
      'sink-consumer',
      [
        `import { createSinkHandler, isAllowedOrigin, type SinkHandler } from '${pkg.name}/sink';`,
        `import fieldNotesDefault, { fieldNotes, type FieldNotesVitePlugin } from '${pkg.name}/vite';`,
        `import { fieldNotesMiddleware } from '${pkg.name}/middleware';`,
        `const allowed: boolean = isAllowedOrigin('http://localhost:1', []);`,
        `const handler: SinkHandler = createSinkHandler({ dir: '.field-notes', token: 't' });`,
        `const plugin: FieldNotesVitePlugin = fieldNotes({ origins: ['http://app.test:*'] });`,
        `const same: FieldNotesVitePlugin = fieldNotesDefault();`,
        `const middleware: SinkHandler = fieldNotesMiddleware({ force: false });`,
        `export { allowed, handler, plugin, same, middleware };`,
      ],
      ['node'],
    );
  });
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (process.exitCode) console.error('smoke: FAILED');
else console.log('smoke: ok');
