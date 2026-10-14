---
'field-notes': minor
---

Add `field-notes export`: one digest of the notes, for a meeting, a doc or a spreadsheet.

- **`export [filters] [--format md|json|csv] [--group-by route|type|author] [--out file]`** takes `list`'s filters and groups by route unless told otherwise.
- **Markdown** lists each note's fields, quotes its body, and links its screenshot. Note text can't add HTML or images, hide where a link goes, or reach outside its note's quote.
- **CSV** has one row per note. A cell that a spreadsheet would run as a formula starts with `'`.
- **JSON** has the notes in groups, each note in the same shape as `list --json`.
