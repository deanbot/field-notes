# Leave notes as you go, fix them in one batch

Walk through your app noting everything you'd change, without stopping to fix anything. Then work through the list.

## Capture

Run your app with a local sink (see the [README](../../README.md#install)) and click through it. Each time something's off, press `Alt+Shift+F` or click the button, pick the element, write a line, and press Ctrl/Cmd+Enter. The screenshot and the page's URL are recorded for you, so a few words are enough.

## Triage

```sh
npx field-notes list                     # every open note, oldest first
npx field-notes list --group-by route    # by page
npx field-notes list --type bug          # one type
npx field-notes show 01JA8X              # one note in full: fields, screenshot path, body
```

An id can be shortened to any unique start.

## Close them out

```sh
npx field-notes resolve 01JA8X 01JA9B --note "Renamed the button" --ref a1b2c3d
npx field-notes wontfix 01JAC2 --note "Out of scope for this release"
npx field-notes reopen 01JA8X            # if it comes back
```

Only `status` and `resolution` change in `note.md`; the rest of the file stays as it was. To clear out closed notes later:

```sh
npx field-notes prune --older-than 30d --dry-run   # see what would go
npx field-notes prune --older-than 30d
```

`prune` never deletes an open note. [docs/cli.md](../cli.md) has every filter and option.
