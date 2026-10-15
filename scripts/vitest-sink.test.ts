import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { removeSinkDir } from './vitest-sink.ts';

it('removes a sink directory while a note is still being written into it', async () => {
  // A plain recursive rm fails most of these rounds with ENOTEMPTY.
  for (let round = 0; round < 20; round++) {
    const dir = await mkdtemp(join(tmpdir(), 'field-notes-sink-reset-'));
    const note = join(dir, 'items', 'note');
    await mkdir(note, { recursive: true });
    const writing = (async () => {
      for (let i = 0; i < 100; i++) {
        try {
          await writeFile(join(note, `file-${String(i)}`), 'x');
        } catch {
          return; // its directory is gone
        }
      }
    })();
    await removeSinkDir(dir);
    await writing;
    expect(existsSync(dir)).toBe(false);
  }
});
