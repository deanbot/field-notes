---
'field-notes': minor
---

Add `field-notes resolve`, `wontfix`, `reopen` and `prune`.

- **`resolve <id...> --note "…" [--ref …]`** and **`wontfix`** close notes. `--note`, plus the ref if given, becomes `resolution`.
- **`reopen <id...>`** opens notes again and clears `resolution`.
- **Safe edits:** these change only `status` and `resolution` in `note.md`. The body, comments, formatting and unknown fields stay byte for byte. If any id fits no note or more than one, nothing is changed.
- **`prune --older-than 30d [--status resolved|wontfix] [--dry-run]`** deletes closed notes that haven't changed for that long, and never deletes open ones. It also removes the local sink's records of client ids once they're older than 7 days.
