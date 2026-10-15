# @deanbot/field-notes

## 1.0.0

### Major Changes

- f0e096d: First release. field-notes captures feedback in context, in any web app: a drop-in `<field-notes>` widget opened from a hotkey, a floating button or your own UI, with an element picker, screenshots and an offline outbox. Notes land as plain files in your project through the Vite plugin, the Node middleware or `field-notes serve`, or travel as an exported zip. The `field-notes` CLI lists, shows, tails, exports, imports and prunes them.

### Minor Changes

- 5ba3961: Add `field-notes export`: one digest of the notes, for a meeting, a doc or a spreadsheet.

  - **`export [filters] [--format md|json|csv] [--group-by route|type|author] [--out file]`** takes `list`'s filters and groups by route unless told otherwise.
  - **Markdown** lists each note's fields, quotes its body, and links its screenshot. Note text can't add HTML or images, hide where a link goes, or reach outside its note's quote.
  - **CSV** has one row per note. A cell that a spreadsheet would run as a formula starts with `'`.
  - **JSON** has the notes in groups, each note in the same shape as `list --json`.

- 1350e97: Add `field-notes import <export.zip> [--dir .field-notes]`: the notes in a zip exported from the widget become notes in the project, written exactly as the sink writes them. The whole zip is checked first, and a broken or hostile one is refused with exit code 1, writing nothing. Notes already there (by id) are skipped, so importing the same zip again changes nothing. A note whose directory name is taken by another note is reported as a conflict, not imported, and the command exits 1.
- ddaeae4: Add `field-notes list` and `field-notes show <id>`, which read the notes in `--dir`.

  - **`list`** prints the matching notes, oldest first, one row per note. Filters: `--status` (`open` by default, or `resolved`, `wontfix`, `all`), `--type`, `--author`, `--route` (`*` matches anything) and `--since` (`2d`, or a date). `--group-by route|type|author` puts the rows under a heading per group.
  - **`show`** prints one note, found by its id or the start of it, with the absolute path of its screenshot.
  - **`--json`** prints each note as `{ dir, screenshot, note }`, where `note` is exactly the spec's JSON shape, unknown fields included. The shape is documented in `docs/cli.md`.
  - **What's skipped:** directories that aren't valid notes are reported on stderr and skipped. That includes a note whose schema is newer than this version reads.
  - **Untrusted text:** text output drops control characters from notes, so a note can't rewrite the terminal. `import` now does the same for the id in its conflict message.

- 7c3e2d9: Add `field-notes resolve`, `wontfix`, `reopen` and `prune`.

  - **`resolve <id...> --note "…" [--ref …]`** and **`wontfix`** close notes. `--note`, plus the ref if given, becomes `resolution`.
  - **`reopen <id...>`** opens notes again and clears `resolution`.
  - **Safe edits:** these change only `status` and `resolution` in `note.md`. The body, comments, formatting and unknown fields stay byte for byte. If any id fits no note or more than one, nothing is changed.
  - **`prune --older-than 30d [--status resolved|wontfix] [--dry-run]`** deletes closed notes that haven't changed for that long, and never deletes open ones. It also removes the local sink's records of client ids once they're older than 7 days.

- 998c8b4: Add `field-notes tail [--json] [--since 2d]`, which prints each new note once as it lands, until Ctrl+C. It's for agent sessions and anything else that acts on notes as they come.

  - **Output:** one line per note, as text or, with `--json`, as JSON in the shape of `list --json`.
  - **`--since`** first prints the notes already there that were created since then.
  - **Bursts:** a burst of notes, or file events the system merges or drops, can't lose a note or print one twice.
  - **Closed pipes:** when its reader stops, as in `tail --json | head -1`, it exits with 0.

- edd2b9b: A `<field-notes>` element written into a page or a framework's template (Vue, React, plain HTML, or a component's shadow root) now carries the widget, after `defineFieldNotes()`. It's configured by attributes, the script tag's without `data-`, and survives the framework re-rendering, moving or replacing it, with one widget per page.
- 3b4e10d: Screenshots: `screenshot: 'display'` (or `data-screenshot="display"`) asks the browser to share this tab, for exact pixels. It keeps a share only where the browser can prove it's this tab (Chromium), and takes the DOM screenshot otherwise. Its masking is paint alone: iframes are painted over, and pseudo-element content drawn outside a masked element's box isn't masked. An image pasted or dropped into the form takes the screenshot's place, as `image.png`. `screenshot: 'off'` accepts none.
- 7d37a2e: Screenshots: each note gets a screenshot of what's on screen, taken as the widget opens (without the widget in it) and again after a pick. Passwords and `[data-field-notes-mask]` content are painted over. The form shows a thumbnail that can be removed. `screenshot: 'off'` (or `data-screenshot="off"` on the script tag) turns them off.
- 949bb1a: Add **Pick element** to the form. The panel steps aside, and the element under the pointer is outlined and labelled (tag and text) before you pick it. ↑/↓ or Alt+wheel climb to the parent and back, ←/→ move between siblings, a click or Enter picks, and Esc cancels; from the keyboard alone, picking starts at the element that had focus. The note records `element: { selector, tag, text, ariaLabel, rect }`. The selector prefers an `id`, a test id (`data-testid` and the like), `aria-label` or `role` over class names, and leaves out hashed or generated names (CSS modules, CSS-in-JS, React ids). Shadow roots, iframes and canvases are picked whole. Text inside `[data-field-notes-mask]` is never recorded. The picker loads on first use.
- b25d451: Export mode asks for the author's name, optionally, on the first note, and keeps it in the browser. "My notes" changes it. An `author` option still overrides it.
- ffaf076: Add `mode: 'export'`, for environments without a sink: notes stay in the browser and nothing is sent anywhere. The badge counts unexported notes. "My notes" has **Export (N)**, which downloads `field-notes-<YYYY-MM-DD-HHmm>.zip`: the `.field-notes/` layout plus an `index.md` digest. Exported notes stay in the browser, and **Download last export again** gives the same zip until the next export or `exportRetentionDays` (default 7). "My notes" says unexported notes are stored only in this browser, and suggests an export at `storageWarning` (default 50 notes or 100 MB). Export is in the npm package only, not the script-tag build.

  Export zips no longer allow attachment names that clash when case is ignored (`a.png` and `A.png`, or `NOTE.MD`), which would overwrite each other on macOS and Windows. Fixed: "My notes" now shows when saving or deleting a note fails.

- c32c986: Coexist with a host's focus trap: Tab, click-to-focus and Esc keep working inside the widget when a host modal's trap cancels them, and Esc no longer reaches the host's page. Add `onOpen` and `onClose` hooks so a host can pause a trap that blocks outside clicks (see docs/recipes/host-focus-trap.md).
- ec79676: Add `field-notes serve`, the standalone local sink on 127.0.0.1 (`--port`, default 4747; `--dir`, default `.field-notes`). It serves the widget for a script tag at `/widget.js`, with its token filled in, and `/health`. It keeps its token in `.field-notes/.token` across restarts. Notes are accepted from loopback pages over http or https; `--origin` (repeatable) allows others, such as `http://app.test:3000`.

  The widget sends notes to the sink once it has a `token` (and an `endpoint`, default `/__field-notes`): oldest first, retrying with backoff while the sink is down and on `online`/`visibilitychange`, without storing a note twice. A note the sink refuses for good shows as rejected in "My notes". Delivered notes leave the outbox after 7 days.

- 7676bb8: Add `enabled: 'query'` for demo and staging builds: the widget stays off, with only the activation stub loaded, until a page is opened with `?field-notes=1`. It then stays on in that browser until `?field-notes=0`. Where storage is blocked, `?field-notes=1` turns it on for that page only.
- 1f51fe2: Add the local sink's request handler, `createSinkHandler` from `@deanbot/field-notes/sink`. It accepts notes at `POST /__field-notes` from allowed origins (localhost and loopback by default) carrying the sink's token. It enforces a size limit and writes each note to `.field-notes/items/<id>-<slug>/` under an id it assigns, with `note.md` written last. A resend with the same `clientId` returns the first receipt instead of storing the note twice.
- 68be3f7: Add `@deanbot/field-notes/vite`, a Vite plugin that takes notes at `/__field-notes` on the dev server (dev only; `vite build` is untouched). Add `@deanbot/field-notes/middleware` for Connect and Express dev servers; with `NODE_ENV=production` it passes every request on unless `force: true`. Both keep notes in `.field-notes/` and accept `dir` and `origins` options.

  A widget on the same server, opened on this machine, needs no options: it asks the sink there for its token. A page on another device needs `token` given. Delivery code now loads whenever a note is waiting.

- 05ec5c5: Add the capture form: a textarea focused on open, type chips (`types`), `Ctrl/Cmd+Enter` to submit and a confirmation toast. Each note records the page (url, route, title, referrer, viewport, user agent, colour scheme, timezone), the text selected when the widget opened, `environment`, `author` and the host's `context()`. Opt-in `consoleErrors` attaches recent errors. Drafts persist in `localStorage`.
- d8323b6: Submitted notes are stored in an IndexedDB outbox first, so they survive reloads before delivery. The button shows a badge with the number of notes not yet sent (the panel header shows it when there's no button), and a "My notes" view lists this browser's notes, with edit and delete for notes not yet sent.
- 45cef49: Add `mountFieldNotes()`: mounts the `<field-notes>` element behind an activation check (`enabled: 'auto' | boolean | () => boolean`), loads the panel lazily on first open, and returns a handle with `open()`, `close()` and `unmount()`. Also builds a self-contained script-tag version (`dist/widget.iife.js`) that exposes `window.FieldNotes`.
- 09a1ccc: Add surfaces: `surface: 'popover' | 'sheet' | 'side'` (`data-surface` on the script tag). Each opens as a modal `<dialog>` in the top layer. The popover is anchored to the button and closes on a click outside; the sheet is the default when there's no button. Theme with `--field-notes-*` custom properties; light and dark follow the user's preference.
- d20ee66: Add triggers: a floating button (`buttonPosition`, `buttonOffset`) and a hotkey (`hotkey`, default `Alt+Shift+F`), chosen with `trigger`. Adds `toggle()` to the handle and to `window.FieldNotes`, and `data-trigger`, `data-position`, `data-offset` and `data-hotkey` for the script tag.

### Patch Changes

- 912b709: Keep the form's buttons inside the panel when an element is picked: a long element label pushed "Add note" past the panel's edge, and off screen.
- 65881d1: Keep "Add note" on one line after an element is picked: the picked element's label shortens instead.
- ea57d3a: Make `screenshot: 'display'` reliable. In Chromium, about one capture in 20 never got a frame of the shared tab, and the widget never opened. Now:

  - A video left waiting for its first frame has the tab send it again.
  - While it waits, the widget keeps the page repainting, by changing one pixel imperceptibly. A tab sends frames only when it repaints.
  - A share that hasn't cropped, or sent a frame, within 2 seconds falls back to the DOM screenshot.

  On a page that doesn't change, a display capture also takes about 0.2 s instead of over 2 s.

- 0a81ed6: A display capture (`screenshot: 'display'`) is now the view, at the view's size, on a page without a doctype and when the widget sits inside a transformed or filtered element. Before, it could be stretched to the page's height, or cropped to that element instead.
- b34622b: The DOM screenshot copies a large page about ten times faster, so the widget opens without a long pause: elements away from the viewport are copied for their layout alone.
- 26be440: Export mode clears exports past `exportRetentionDays` whenever the panel opens, not only when "My notes" does.
- 2fcbb27: The DOM screenshot is no longer blank or shifted on some pages:

  - **Pages whose Content Security Policy blocks `data:` images** used to get a blank screenshot. The copy is drawn from one such image, so the note now goes without a screenshot, and the console says why.
  - **Quirks-mode pages** (no doctype) were copied scrolled twice over, and as tall as the whole page when it had been scrolled. They are now copied as they look.

- e9eca7d: Stop the DOM screenshot logging "Layout was forced before the page was fully loaded" to the host page's console in Firefox. Its hidden style frame is no longer displayed while it loads, so Firefox doesn't lay it out with the page. The screenshot also waits for that frame to load before reading styles from it, so in Firefox a page with a `<video>` no longer goes without a screenshot. Default styles now come from a standards-mode document in every engine.
- edf3e0f: Notes waiting to be sent go as soon as the network comes back, even if it comes back during a failing attempt. They used to wait out the retry backoff, which can reach a minute.
