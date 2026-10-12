---
'field-notes': minor
---

Add surfaces: `surface: 'popover' | 'sheet' | 'side'` (`data-surface` on the script tag). Each opens as a modal `<dialog>` in the top layer. The popover is anchored to the button and closes on a click outside; the sheet is the default when there's no button. Theme with `--field-notes-*` custom properties; light and dark follow the user's preference.
