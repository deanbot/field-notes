---
'field-notes': minor
---

Submitted notes are stored in an IndexedDB outbox first, so they survive reloads before delivery. The button shows a badge with the number of notes not yet sent (the panel header shows it when there's no button), and a "My notes" view lists this browser's notes, with edit and delete for notes not yet sent.
