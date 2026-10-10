import { defineConfig, type UserConfig } from 'tsdown';

// Workspace packages are private implementation details: always bundle them,
// in both the JavaScript and the declaration output, so the published package
// has zero runtime dependencies and no dangling `@field-notes/*` imports.
const workspace = /^@field-notes\//;

const shared: UserConfig = {
  format: 'esm',
  fixedExtension: false,
  sourcemap: true,
  dts: { sourcemap: false },
  deps: {
    alwaysBundle: [workspace],
    dts: { alwaysBundle: [workspace] },
    // Nothing may be imported at runtime except Node built-ins.
    onlyImport: [],
  },
};

export default defineConfig([
  {
    ...shared,
    name: 'browser',
    entry: { index: 'src/index.ts' },
    platform: 'browser',
    target: 'es2022',
  },
  {
    ...shared,
    name: 'node',
    entry: { sink: 'src/sink.ts' },
    platform: 'node',
    target: 'node22',
    clean: false,
  },
  {
    ...shared,
    name: 'bin',
    entry: { cli: 'src/cli.ts' },
    platform: 'node',
    target: 'node22',
    dts: false,
    clean: false,
  },
]);
