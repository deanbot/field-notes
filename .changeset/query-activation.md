---
'field-notes': minor
---

Add `enabled: 'query'` for demo and staging builds: the widget stays off, with only the activation stub loaded, until a page is opened with `?field-notes=1`. It then stays on in that browser until `?field-notes=0`. Where storage is blocked, `?field-notes=1` turns it on for that page only.
