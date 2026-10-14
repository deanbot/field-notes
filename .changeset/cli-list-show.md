---
'field-notes': minor
---

Add `field-notes list` and `field-notes show <id>`, which read the notes in `--dir`.

- **`list`** prints the matching notes, oldest first, one row per note. Filters: `--status` (`open` by default, or `resolved`, `wontfix`, `all`), `--type`, `--author`, `--route` (`*` matches anything) and `--since` (`2d`, or a date). `--group-by route|type|author` puts the rows under a heading per group.
- **`show`** prints one note, found by its id or the start of it, with the absolute path of its screenshot.
- **`--json`** prints each note as `{ dir, screenshot, note }`, where `note` is exactly the spec's JSON shape, unknown fields included. The shape is documented in `docs/cli.md`.
- **What's skipped:** directories that aren't valid notes are reported on stderr and skipped. That includes a note whose schema is newer than this version reads.
- **Untrusted text:** text output drops control characters from notes, so a note can't rewrite the terminal. `import` now does the same for the id in its conflict message.
