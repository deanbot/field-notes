---
'field-notes': minor
---

A `<field-notes>` element written into a page or a framework's template (Vue, React, plain HTML) now carries the widget, after `defineFieldNotes()`. It's configured by attributes, the script tag's without `data-`, and survives the framework re-rendering, moving or replacing it, with one widget per page.
