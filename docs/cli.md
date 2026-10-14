# The `field-notes` CLI

Reads and serves the notes in a project's `.field-notes/` directory. `field-notes --help` lists every command. Each command takes `--dir <path>` for a notes directory other than `.field-notes`.

## Reading notes

```
field-notes list [--status open] [--type t] [--author a] [--route r] [--since 2d] [--group-by route|type|author] [--json]
field-notes show <id> [--json]
```

- **`list`** prints the notes that match, oldest first: by `created`, then `id`. Without `--json` it prints one row per note: id, status, type, route and the body's first line. A `-` stands for a field the note doesn't have.
- **`show`** prints one note: its fields, the absolute path of its screenshot, its directory, then its body. `<id>` is the note's `id` or the start of it, in any case. If more than one note fits, it lists them and exits 1.

### Filters

Each filter but `--since` can be given more than once, and a note matches if it fits any of the values. Different filters must all match.

| Filter               | Matches                                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `--status`           | `open` (the default), `resolved`, `wontfix`, or `all`                                                                |
| `--type`, `--author` | The whole value, in any case                                                                                         |
| `--route`            | The whole route. `*` matches anything, so `/checkout/*` matches every page under `/checkout/`                        |
| `--since`            | Notes created in the last `30m`, `12h`, `2d` or `1w`, or since a date such as `2026-10-01` or `2026-10-01T09:00:00Z` |

A date, or a date-time without an offset, is local time, as in git. A note without the field never matches that filter.

`--group-by` puts rows under a heading per value, and notes without one under `(no route)`, `(no type)` or `(no author)`. Types and authors are grouped in any case, as they're filtered, under the first note's spelling.

### `--json`

`list --json` prints a JSON array, and `show --json` prints one object. Each note is printed as:

```json
{
  "dir": "/home/sam/app/.field-notes/items/01JA8X3Q7K2M9V5T0N4R6P8W1Y-the-place-order-button",
  "screenshot": "/home/sam/app/.field-notes/items/01JA8X3Q7K2M9V5T0N4R6P8W1Y-the-place-order-button/screenshot.png",
  "note": { "id": "01JA8X3Q7K2M9V5T0N4R6P8W1Y", "schema": 1, "status": "open", "body": "…" }
}
```

- `dir` is the note's directory, absolute.
- `screenshot` is the screenshot's absolute path, or `null` when the note has none or the file isn't there.
- `note` is the note in the [JSON shape of the spec](../spec/SPEC.md#json-shape), exactly as in `note.md`, unknown fields included. The CLI adds nothing to it, so what a note may hold can't clash with what the CLI adds.

This shape is stable within a major version. New keys may be added next to `dir`, never inside `note`. With `--group-by`, the array has the same shape, ordered by group.

Notes are text from whoever could use the widget. Text output drops control characters, so a note can't rewrite your terminal. `--json` keeps the text as it is, escaped as JSON.

### What isn't a note

The CLI reads only `items/*/note.md`, and finds notes by the `id` in `note.md`, not by directory name.

- A directory without `note.md` is still being written, and is skipped silently.
- A `note.md` that isn't valid, or whose `schema` is newer than 1, is reported on stderr and skipped. The other notes are still listed.
- Symlinked directories aren't followed.
- If `items/` doesn't exist, there are no notes, and that isn't an error.

## Changing notes

```
field-notes resolve <id...> --note "what was done" [--ref <commit|PR|issue>]
field-notes wontfix <id...> --note "why not" [--ref <where it was decided>]
field-notes reopen <id...>
field-notes prune --older-than 30d [--status resolved|wontfix] [--dry-run]
```

- **`resolve`, `wontfix` and `reopen`** change only `status` and `resolution` in `note.md`. Everything else stays byte for byte: the body, comments, formatting and unknown fields. A field the note doesn't have yet is added at the end of the frontmatter.
  - `--note` is required for `resolve` and `wontfix`. With `--ref`, `resolution` is `<note> (ref: <ref>)`.
  - `reopen` sets `resolution` to `null`, and adds no `resolution` to a note that never had one.
  - Ids work as for `show`. If any id fits no note or more than one, nothing is changed and the command exits 1. A note that already has the status and resolution is left alone.
- **`prune`** deletes notes that are resolved or won't fix (or just the `--status` given) and whose `note.md` hasn't changed for `--older-than` (`30m`, `12h`, `2d`, `1w`). It never deletes an open note: `--status open` is refused, and each note is read again just before it goes, in case it was reopened.
  - The age comes from the file's modification time, which is when `resolve` or `wontfix` last changed it. Copying the notes resets it, which only makes them look newer.
  - Directories that aren't valid notes are never deleted.
  - `--dry-run` lists what would be deleted, and deletes nothing.
  - `prune` also removes the local sink's records of the notes it was sent (`.sink/keys/`) once they're older than the widget keeps a delivered note (7 days). The sink keeps them so that a note sent twice is stored once.

## Exit codes

| Code | Meaning                                                                                                                      |
| ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| 0    | Done. That includes `list` finding no notes, which it reports on stderr.                                                     |
| 1    | It couldn't be done: the notes directory can't be read, an id fits no single note, or a note couldn't be changed or deleted. |
| 2    | The command line is wrong: an unknown command or option, an option the command doesn't take, or a bad value.                 |
