# Notes on a demo or staging build, with no backend

Someone preparing a demo, or reviewing a release on staging, notes what should change. There's no sink to send to, so the notes stay in their browser until they export them, and whoever makes the changes imports the zip.

## Build it in

Mount the widget in export mode, switched on by a query parameter, so visitors who don't know about it never see it:

```ts
import { mountFieldNotes } from 'field-notes';

mountFieldNotes({ mode: 'export', enabled: 'query' });
```

Only a small activation stub ships in the build. The rest loads once the widget is on. [`examples/vite-vue`](../../examples/vite-vue/README.md) builds this way with `vite build --mode export`.

## Take notes

1. Open the build with `?field-notes=1` at the end of the URL. The widget stays on in that browser until `?field-notes=0`.
2. Leave notes as usual. The first one asks for a name, optionally, and remembers it.
3. The button shows how many notes haven't been exported yet. They're stored only in this browser: clearing site data or switching devices loses them.
4. Open **My notes** and click **Export**. A `field-notes-<date>.zip` downloads, and the count goes back to 0. **Download last export again** stays available for a week, in case the file went missing.

## Hand them over

Send the zip to whoever makes the changes. In their project:

```sh
npx field-notes import field-notes-2026-10-14-0930.zip
npx field-notes list
```

Importing the same zip twice is safe: notes already there are skipped. From there, it's the [batch triage recipe](batch-triage.md), or a [digest for a ticket](digest-to-an-issue.md).
