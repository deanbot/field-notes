# field-notes with Next.js

A one-page Next.js app (App Router, React 19, server rendering) with field-notes in local mode.

- **The sink:** [`server.ts`](server.ts) is a custom server that puts `fieldNotesMiddleware()` in front of Next's request handler, so notes from the widget land in `.field-notes/` here.
  - A custom server is needed because Next's `proxy.ts` (formerly `middleware.ts`) runs where it can't write files.
  - A route handler can't take the sink's path either: App Router doesn't route folders starting with `_`.
- **The widget:** [`app/field-notes.tsx`](app/field-notes.tsx) is a client component that mounts it in an effect, in development only, and unmounts it on cleanup. That keeps it to one widget when React runs effects twice in development.
- **Production:** `next build` leaves the widget out of what it sends to browsers. With `NODE_ENV=production`, the middleware stands aside.

Run `pnpm dev`, then open http://localhost:3000.

From the repo root, `pnpm e2e` builds this example and runs its end-to-end tests ([`tests/e2e/next.spec.ts`](../../tests/e2e/next.spec.ts)) in Chromium, Firefox and WebKit.
