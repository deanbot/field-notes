---
'field-notes': patch
---

Stop the DOM screenshot logging "Layout was forced before the page was fully loaded" to the host page's console in Firefox. Its hidden style frame is no longer displayed while it loads, so Firefox doesn't lay it out with the page. The screenshot also waits for that frame to load before reading styles from it, so in Firefox a page with a `<video>` no longer goes without a screenshot. Default styles now come from a standards-mode document in every engine.
