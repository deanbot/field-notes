// Setting a sink's directory up: `items/`, `.gitignore`, then the token.
// Synchronous, so a middleware factory can call it.
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_GITIGNORE } from './store.ts';

const TOKEN = /^[\w-]{20,}$/;

const hasCode = (error: unknown, code: string): boolean =>
  error instanceof Error && (error as NodeJS.ErrnoException).code === code;

/**
 * Creates `dir/items/` and `dir/.gitignore` (unless there's one), then
 * returns the token in `dir/.token`, writing a new one (owner-only) if
 * there's none. `.gitignore` comes first, so git never sees the token.
 * Kept across restarts, so an open tab's token keeps working.
 */
export function prepareSinkDir(dir: string, gitignore: string | false = DEFAULT_GITIGNORE): string {
  mkdirSync(join(dir, 'items'), { recursive: true });
  if (gitignore !== false) {
    try {
      writeFileSync(join(dir, '.gitignore'), gitignore, { flag: 'wx' });
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) throw error;
    }
  }
  const file = join(dir, '.token');
  let existing = '';
  try {
    existing = readFileSync(file, 'utf8').trim();
  } catch (error) {
    if (!hasCode(error, 'ENOENT')) throw error;
  }
  if (TOKEN.test(existing)) return existing;
  const token = randomBytes(32).toString('base64url');
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  return token;
}
