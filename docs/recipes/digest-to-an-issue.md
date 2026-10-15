# A digest of notes for an issue, a doc or a spreadsheet

After a review, turn the notes into one document to paste into a ticket, a planning doc or a spreadsheet.

## Make the digest

```sh
npx field-notes export --format md --out review.md                  # grouped by page
npx field-notes export --format md --group-by type --out review.md  # or by type
npx field-notes export --format csv --out review.csv                # for a spreadsheet
npx field-notes export --format md --route '/checkout/*' --since 1w # filters work as for list
```

The markdown has a heading per page, then each note's first line, its fields, its body as a quote, and a link to its screenshot. Screenshot links are relative to the `--out` file.

## Before you paste it

- **Screenshots are linked, not embedded.** Most trackers and docs don't show embedded images. Attach the screenshots you want to the ticket yourself.
- **On GitHub, `@name` in a note mentions that person or team, and `#123` links that issue.** Notes are text from whoever used the widget, so read the digest before posting it.
- Note text can't add HTML, images or hidden links to the digest, and can't break out of its own quote. In CSV, a cell that a spreadsheet would run as a formula starts with `'`.

## Then close the notes

Once the ticket exists, point the notes at it:

```sh
npx field-notes resolve 01JA8X 01JA9B --note "Moved to the tracker" --ref https://github.com/acme/shop/issues/42
```

[docs/cli.md](../cli.md#digests) has every format and option.
