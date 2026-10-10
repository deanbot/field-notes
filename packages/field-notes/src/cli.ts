#!/usr/bin/env node
import process from 'node:process';
import { run } from '@field-notes/cli';
import pkg from '../package.json' with { type: 'json' };

process.exitCode = run(process.argv.slice(2), {
  version: pkg.version,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
});
