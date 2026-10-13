---
'field-notes': patch
---

Notes waiting to be sent go as soon as the network comes back, even if it comes back during a failing attempt. They used to wait out the retry backoff, which can reach a minute.
