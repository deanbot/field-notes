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
    // Rolldown's browser platform would fill this in now; leave it for the
    // consumer's bundler, which knows whether it's making a production build.
    define: { 'process.env.NODE_ENV': 'process.env.NODE_ENV' },
    // The panel is a lazy chunk: the entry stays an activation stub.
    outputOptions: { chunkFileNames: '[name]-[hash].js' },
    // Minified so the size budgets measure what a page actually loads;
    // sourcemaps keep it debuggable.
    minify: true,
  },
  {
    ...shared,
    // Self-contained script for a <script> tag, served by the local sink.
    // Classic scripts can't import chunks, so the panel is inlined.
    name: 'script-tag',
    entry: { widget: 'src/script-tag.ts' },
    format: 'iife',
    globalName: 'FieldNotes',
    // Only the local dev sink serves this build, so `enabled: 'auto'` is on.
    define: { 'process.env.NODE_ENV': '"development"' },
    platform: 'browser',
    target: 'es2022',
    minify: true,
    dts: false,
    clean: false,
    outputOptions: { codeSplitting: false },
  },
  {
    ...shared,
    name: 'node',
    entry: { sink: 'src/sink.ts', vite: 'src/vite.ts', middleware: 'src/middleware.ts' },
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
