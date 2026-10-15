# field-notes with Vite and Vue

A one-page Vue 3 app with field-notes in both modes:

- **Local mode** (`pnpm dev`): the [Vite plugin](../../README.md) takes notes on the dev server, and they land in `.field-notes/` here.
- **Export mode** (`pnpm build:export`, then `pnpm preview:export`): a production build for a demo or staging site. The widget stays off until the page is opened with `?field-notes=1`, and notes stay in the browser until they're exported as a zip. Run `field-notes import <zip>` to add them to a project.
- **Any other production build** (`pnpm build`) leaves the widget out entirely.

The widget is a `<field-notes>` element in the app's own template, in [`src/FieldNotes.vue`](src/FieldNotes.vue), configured by its attributes. `defineFieldNotes()` makes it carry the widget. [`vite.config.ts`](vite.config.ts) adds the plugin, and tells Vue with `isCustomElement` that `<field-notes>` is a custom element. [`src/App.vue`](src/App.vue) loads the component only in dev and export builds. An app that would rather not touch its templates can call `mountFieldNotes()` instead: the widget then adds its own element to `<body>`.

From the repo root, `pnpm e2e` builds this example and runs its end-to-end tests ([`tests/e2e/vite-vue.spec.ts`](../../tests/e2e/vite-vue.spec.ts)) in Chromium, Firefox and WebKit.
