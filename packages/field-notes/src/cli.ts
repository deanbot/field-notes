#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { run } from '@field-notes/cli';
import pkg from '../package.json' with { type: 'json' };

const stop = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    stop.abort();
  });
}

// A reader that stops early, as `tail --json | head -1` does, ends the command.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code !== 'EPIPE') throw error;
  stop.abort();
});

process.exitCode = await run(process.argv.slice(2), {
  version: pkg.version,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  // Next to this file in dist/.
  widgetScript: () => readFile(new URL('widget.iife.js', import.meta.url), 'utf8'),
  signal: stop.signal,
});
