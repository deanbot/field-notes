---
'field-notes': minor
---

Add `mode: 'export'`, for environments without a sink: notes stay in the browser and nothing is sent anywhere. The badge counts unexported notes. "My notes" has **Export (N)**, which downloads `field-notes-<YYYY-MM-DD-HHmm>.zip`: the `.field-notes/` layout plus an `index.md` digest. Exported notes stay in the browser, and **Download last export again** gives the same zip until the next export or `exportRetentionDays` (default 7). "My notes" says unexported notes are stored only in this browser, and suggests an export at `storageWarning` (default 50 notes or 100 MB). Export is in the npm package only, not the script-tag build.

Export zips no longer allow attachment names that clash when case is ignored (`a.png` and `A.png`, or `NOTE.MD`), which would overwrite each other on macOS and Windows. Fixed: "My notes" now shows when saving or deleting a note fails.
