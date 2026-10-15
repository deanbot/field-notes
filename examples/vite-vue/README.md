# field-notes with Vite and Vue

A one-page Vue 3 app with field-notes in both modes:

- **Local mode** (`pnpm dev`): the [Vite plugin](../../README.md) takes notes on the dev server, and they land in `.field-notes/` here.
- **Export mode** (`pnpm build:export`, then `pnpm preview:export`): a production build for a demo or staging site. The widget stays off until the page is opened with `?field-notes=1`, and notes stay in the browser until they're exported as a zip. Run `field-notes import <zip>` to add them to a project.
- **Any other production build** (`pnpm build`) leaves the widget out entirely.

The whole integration is two lines in [`vite.config.ts`](vite.config.ts) and a few in [`src/main.ts`](src/main.ts). The widget adds its own `<field-notes>` element to `<body>`, outside the Vue app, so Vue needs no `isCustomElement` setting for it.

From the repo root, `pnpm e2e` builds this example and runs its end-to-end tests ([`tests/e2e/vite-vue.spec.ts`](../../tests/e2e/vite-vue.spec.ts)) in Chromium, Firefox and WebKit.
