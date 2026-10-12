---
'field-notes': minor
---

Add `field-notes serve`, the standalone local sink on 127.0.0.1 (`--port`, default 4747; `--dir`, default `.field-notes`). It serves the widget for a script tag at `/widget.js`, with its token filled in, and `/health`. It keeps its token in `.field-notes/.token` across restarts.

The widget sends notes to the sink once it has a `token` (and an `endpoint`, default `/__field-notes`): oldest first, retrying with backoff while the sink is down and on `online`/`visibilitychange`, without storing a note twice. A note the sink refuses for good shows as rejected in "My notes". Delivered notes leave the outbox after 7 days.
