---
'field-notes': minor
---

Add `field-notes tail [--json] [--since 2d]`, which prints each new note once as it lands, until Ctrl+C. It's for agent sessions and anything else that acts on notes as they come.

- **Output:** one line per note, as text or, with `--json`, as JSON in the shape of `list --json`.
- **`--since`** first prints the notes already there that were created since then.
- **Bursts:** a burst of notes, or file events the system merges or drops, can't lose a note or print one twice.
- **Closed pipes:** when its reader stops, as in `tail --json | head -1`, it exits with 0.
