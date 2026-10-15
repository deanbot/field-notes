---
'field-notes': patch
---

The DOM screenshot is no longer blank or shifted on some pages:

- **Pages whose Content Security Policy blocks `data:` images** used to get a blank screenshot. The copy is drawn from one such image, so the note now goes without a screenshot, and the console says why.
- **Quirks-mode pages** (no doctype) were copied scrolled twice over, and as tall as the whole page when it had been scrolled. They are now copied as they look.
