---
'field-notes': minor
---

Coexist with a host's focus trap: Tab, click-to-focus and Esc keep working inside the widget when a host modal's trap cancels them, and Esc no longer reaches the host's page. Add `onOpen` and `onClose` hooks so a host can pause a trap that blocks outside clicks (see docs/recipes/host-focus-trap.md).
