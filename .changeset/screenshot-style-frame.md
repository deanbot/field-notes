---
'field-notes': patch
---

Load the DOM screenshot's hidden style frame before copying the page. In Firefox, reading styles from it while it was still loading logged "Layout was forced before the page was fully loaded" to the host page's console, and on a page with a `<video>` the screenshot failed. Default styles now come from a standards-mode document in every engine.
