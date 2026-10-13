---
'field-notes': minor
---

Screenshots: `screenshot: 'display'` (or `data-screenshot="display"`) asks the browser to share this tab, for exact pixels. It keeps a share only where the browser can prove it's this tab (Chromium), and takes the DOM screenshot otherwise. An image pasted or dropped into the form takes the screenshot's place, as `image.png`. `screenshot: 'off'` accepts none.
