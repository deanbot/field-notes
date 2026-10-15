---
'field-notes': patch
---

Make `screenshot: 'display'` reliable. In Chromium, about one capture in 20 never got a frame of the shared tab, and the widget never opened. Now:

- A video left waiting for its first frame has the tab send it again.
- While it waits, the widget keeps the page repainting, by changing one pixel imperceptibly. A tab sends frames only when it repaints.
- A share that hasn't cropped, or sent a frame, within 2 seconds falls back to the DOM screenshot.

On a page that doesn't change, a display capture also takes about 0.2 s instead of over 2 s.
