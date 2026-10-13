---
'field-notes': minor
---

Add `field-notes import <export.zip> [--dir .field-notes]`: the notes in a zip exported from the widget become notes in the project, written exactly as the sink writes them. The whole zip is checked first, and a broken or hostile one is refused with exit code 1, writing nothing. Notes already there (by id) are skipped, so importing the same zip again changes nothing. A note whose directory name is taken by another note is reported as a conflict, not imported, and the command exits 1.
