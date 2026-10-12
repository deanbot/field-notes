---
'field-notes': minor
---

Add `mountFieldNotes()`: mounts the `<field-notes>` element behind an activation check (`enabled: 'auto' | boolean | () => boolean`), loads the panel lazily on first open, and returns a handle with `open()`, `close()` and `unmount()`. Also builds a self-contained script-tag version (`dist/widget.iife.js`) that exposes `window.FieldNotes`.
