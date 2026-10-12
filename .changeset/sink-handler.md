---
'field-notes': minor
---

Add the local sink's request handler, `createSinkHandler` from `field-notes/sink`. It accepts notes at `POST /__field-notes` from allowed origins (localhost and loopback by default) carrying the sink's token. It enforces a size limit and writes each note to `.field-notes/items/<id>-<slug>/` under an id it assigns, with `note.md` written last. A resend with the same `clientId` returns the first receipt instead of storing the note twice.
