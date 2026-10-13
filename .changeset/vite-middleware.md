---
'field-notes': minor
---

Add `field-notes/vite`, a Vite plugin that takes notes at `/__field-notes` on the dev server (dev only; `vite build` is untouched). Add `field-notes/middleware` for Connect and Express dev servers; with `NODE_ENV=production` it passes every request on unless `force: true`. Both keep notes in `.field-notes/` and accept `dir` and `origins` options.

A widget on the same server, opened on this machine, needs no options: it asks the sink there for its token. A page on another device needs `token` given. Delivery code now loads whenever a note is waiting.
