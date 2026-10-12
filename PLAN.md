# field-notes — Plan

> _Rapid, in-context feedback capture for any web app._

**field-notes** lets anyone using an app jot down what they want changed, right where they see it, without switching context. A drop-in widget opens from a hotkey, a floating button or the host app's own UI. Each note carries its own context (URL, element, screenshot, who wrote it), so whoever acts on it later doesn't need to be told where the author was or what they meant. That could be a developer, a coding agent, a team lead or a backlog.

Capture is asynchronous. Nothing needs to be watching. Notes accumulate and get processed in batches, or live if something is listening.

---

## 1. Design principle: open-ended by construction

The tool is built on two independent axes, and **no use case is baked in**:

- **Capture:** a person notes something in context. This is the same for everyone.
- **Delivery:** the note goes somewhere, through a transport (§4).

Nothing in the widget, the note format or the CLI refers to a persona or a workflow. Note fields are descriptive (who, where, what, when), not tied to a role. `type`, `tags` and `context` are open-ended and configurable. Transports and recipes are extension points. A new use case should only ever need a new recipe or transport, never a schema or API change.

**Durability rule for docs and notes:** use cases appear only as _examples_ ("for instance…", "some ways people use it"). They are never presented as a complete list. Persona names never appear in the schema, config keys, CLI flags or defaults. The README's examples section can grow or change without touching anything else.

### Illustrative use cases (not exhaustive)

These shaped the requirements. They are not the boundary of the product.

| example                       | scenario                                                                                                                                      | app runs on                | notes go to                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------- |
| **Developer + agent**         | An agent session tails new notes and acts on them. This is a better UX than typing instructions into a terminal while looking at the browser. | localhost                  | project folder, picked up live                           |
| **Implementation team**       | Building pages quickly: click through the new pages, note gaps, hand off in a batch.                                                          | localhost / preview deploy | project folder or a shared collector                     |
| **Product owner / sales rep** | Preparing for a demo or reviewing a release: note what they want changed. This feeds work management and requirement gathering.               | staging / demo / prod-like | a shared collector, issue tracker, or an exported bundle |
| **Stakeholder review**        | Several reviewers mark up the same build.                                                                                                     | preview / staging          | a shared collector with each author recorded             |

Other examples include QA passes, accessibility audits, client sign-off, copy or content review, design QA against mocks, onboarding walkthroughs and internal dogfooding. The list is open.

### v1 scope: two delivery modes, no hosted infrastructure

| mode                  | how notes leave the browser                                                     | where it fits                                                                                   |
| --------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **`local`** (default) | immediately POSTed to a local sink, which writes `.field-notes/` in the project | the app runs on localhost; notes can be picked up live                                          |
| **`export`**          | kept in the browser; the user downloads a zip when ready                        | any environment, including demo/staging, with no backend; also a zero-setup way to try the tool |

Real-time delivery from hosted environments (HTTP endpoint, shared collector, issue trackers) is deferred to **future transport adapters**. Both v1 modes are implementations of one internal `Transport` interface, and the note format is transport-neutral, so adding more later is additive.

---

## 2. Shape of the thing

- **A framework-agnostic widget.** It is a Custom Element (`<field-notes>`) that renders inside a Shadow DOM, so host CSS can't break it and it can't leak styles into the host. It works in React, Vue, Svelte, Angular, server-rendered apps and plain HTML.
- **An npm package plus a `<script>`-tag build,** for stacks without npm.
- **A local sink** receives notes and writes them to `.field-notes/` (§4). The **note format is the contract** (§6).

```
 Browser (localhost)              Local machine                         Readers
┌─────────────────┐  POST    ┌──────────────────────────┐  files   ┌──────────────────────────────┐
│ <field-notes>   │ ───────▶ │ sink: serve | vite |     │ ───────▶ │ .field-notes/items/*/note.md │
│  capture+outbox │          │  middleware              │          │  + screenshot.png            │
│  [Transport] ◀──┼─ seam: local (v1), export (v1), future: http, collector, trackers            │
└─────────────────┘          └──────────────────────────┘          └──────────────────────────────┘
        │ export mode: "Export (7)" → field-notes-<date>.zip ──▶ unzip / `field-notes import` ──▶ .field-notes/
```

---

## 3. Widget (browser)

### Install

```js
import { mountFieldNotes } from 'field-notes';
if (import.meta.env.DEV) mountFieldNotes({ position: 'bottom-right' });
```

```html
<!-- served by the local sink; no CDN or build step -->
<script src="http://localhost:4747/widget.js" data-position="bottom-left"></script>
```

### Triggers and surfaces (independent of each other)

The floating button is only one way in. **How you open it** and **what opens** are configured separately:

| `trigger` (any combination) |                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `'button'`                  | floating button; `buttonPosition` sets the corner plus an `offset`                                           |
| `'hotkey'`                  | keyboard shortcut (`hotkey`, default `Alt+Shift+F`); works with no visible UI at all                         |
| `'api'`                     | always on: `fieldNotes.open()`, `.close()`, `.toggle()`, so the host can wire up its own menu item or button |

| `surface`                           |                                                                                                                                                                       |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'popover'` (default with a button) | compact panel anchored to the button                                                                                                                                  |
| `'sheet'`                           | bottom sheet: full width, slides up and covers at most ~40% of the viewport so the page stays visible above it. Good default for hotkey-only setups and small screens |
| `'side'`                            | docked side panel; useful for long batches of notes                                                                                                                   |

```js
mountFieldNotes({ trigger: ['hotkey'], surface: 'sheet' }); // shortcut → bottom sheet, no button on screen
```

Every surface shares the same form and capture logic, so a surface is only layout. When the element picker runs, the sheet or panel collapses so the whole page can be picked from, then restores. Screenshots are always taken before the surface renders. With no button on screen, the note count (local outbox or export mode) appears in the sheet's header, and a brief toast after each submit confirms it.

### Activation

| `enabled`          | behaviour                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `'auto'` (default) | on in dev builds; a no-op in production builds                                                                                              |
| `'query'`          | `?field-notes=1` turns it on for this browser (persisted); `?field-notes=0` turns it off. Intended for demo/staging builds in `export` mode |
| `() => boolean`    | host decides, e.g. `location.hostname.startsWith('demo.')`                                                                                  |
| `true` / `false`   | forced                                                                                                                                      |

Production builds tree-shake the widget away when it's guarded by `import.meta.env.DEV` / `process.env.NODE_ENV`. A demo build that wants the widget includes it and uses `'query'` or a function. Then only a small activation stub ships, and the panel, screenshot and zip code load lazily once the widget is turned on.

### Configuration

| option           | default                                                                      | notes                                                                                       |
| ---------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `trigger`        | `['button', 'hotkey']`                                                       | any of `'button' \| 'hotkey'`; the `api` is always available                                |
| `surface`        | `'popover'`; `'sheet'` if there's no button                                  | `'popover' \| 'sheet' \| 'side'`                                                            |
| `buttonPosition` | `bottom-right`                                                               | `top-left`, `top-right`, `bottom-left`, `bottom-right`, plus an `offset`                    |
| `mode`           | `'local'`                                                                    | `'local' \| 'export'`                                                                       |
| `endpoint`       | same-origin `/__field-notes`, else `http://localhost:4747`                   | `local` mode only                                                                           |
| `token`          | auto-injected by the Vite plugin / script tag                                | required by the standalone sink                                                             |
| `author`         | `local`: the sink's `git config user.name`; `export`: asked once, remembered | `string \| () => string` to override                                                        |
| `types`          | `['bug', 'change', 'idea', 'question']`                                      | one-click chip; maps to labels downstream                                                   |
| `hotkey`         | `Alt+Shift+F`                                                                | configurable; conflicts with the host are documented                                        |
| `context`        | —                                                                            | `() => object \| Promise<object>`: app version, tenant, feature flags, store state …        |
| `screenshot`     | `'dom'`                                                                      | `'dom' \| 'display' \| 'off'`                                                               |
| `theme`          | `auto`                                                                       | light/dark follows `prefers-color-scheme`; override via `--field-notes-*` custom properties |

### Capture flow (built to keep you focused)

1. Press the hotkey, click the button, or call `open()`. The chosen surface opens with the textarea already focused.
2. Optional: **Pick element** with a crosshair. It records the element's selector, text and bounding box.
3. Optional: a screenshot. It is on by default and taken _before_ the panel renders, so the panel isn't in the shot.
4. Optional: a type chip (bug/change/idea/question).
5. `Ctrl/Cmd+Enter` submits, the panel closes, a toast confirms, and you're back in the app.
6. Drafts persist across reloads and HMR.

A **"My notes" drawer** lists this session's notes, so the author can review, edit or delete them.

### Metadata captured automatically

- `url`, `route`, `title`, `referrer`, `environment` (from config; defaults to `local`)
- `viewport`, `devicePixelRatio`, `userAgent`, `colorScheme`
- `timestamp`, timezone
- `author`, `type`
- `selection`: any text highlighted when the panel opened
- `element`: `{ selector, text, tag, rect, ariaLabel }` from the picker
- `consoleErrors`: the last N errors (opt-in)
- `context`: the output of the user's `context()` callback

### Screenshots

- **Default `dom`:** DOM rasterization with `modern-screenshot`, lazy-loaded. There is no permission prompt. **Documented limits:** cross-origin images, iframes, tainted canvas/video, some CSS.
- **`display`:** `getDisplayMedia` gives pixel-perfect output but shows a browser permission prompt each time.
- **Paste or drop** an image into the panel.
- **Privacy:** passwords and `[data-field-notes-mask]` are masked.

### Resilience

Every note is written to an IndexedDB outbox first, then delivered. In `local` mode, if the sink is down (for example, the dev server is restarting), the button shows a badge (or the sheet header, if there's no button) with the pending count and retries with backoff, and on `online` / `visibilitychange`.

### Export mode

The outbox _is_ the store. Nothing is sent anywhere until the user exports.

1. The user logs notes as normal, and the badge shows the count of unexported notes.
2. The "My notes" drawer lists them for review, edit or delete, with an **Export (N)** button.
3. Export builds a zip in the browser (`fflate`, lazy-loaded) and downloads `field-notes-<YYYY-MM-DD-HHmm>.zip`. The badge drops to 0.
4. **The zip is the artifact.** It uses exactly the `.field-notes/` layout (`items/<id>/note.md` + `screenshot.png`) plus a top-level `index.md`: a human-readable digest with a table of notes and links to each item. Unzipping it into a project, or running `field-notes import <zip>`, makes the notes indistinguishable from ones the sink wrote.

**Details:**

- **Exporting doesn't delete.** Browsers can't confirm a download succeeded, so exported notes move to an `exported` state in IndexedDB. The badge excludes them. **"Download last export again"** stays available until the next export or a configurable retention period (default 7 days), after which they're purged.
- **The ID is assigned in the browser** (ULID) in this mode, because there's no sink. The schema already treats the ID as opaque, and `import` skips IDs it already has, so re-importing the same zip is idempotent.
- **Notes are browser-local, and the UI says so.** The drawer shows a "N notes not yet exported, stored only in this browser" hint. Clearing site data, private windows or switching device loses unexported notes.
- **Storage guard:** a warning appears above a configurable threshold (default 50 notes or 100 MB), suggesting an export. Screenshots dominate the size.

---

## 4. Local sink

- **Three ways to run it:** `npx field-notes serve` (standalone, works with any backend language), a Vite plugin, or Connect/Express middleware (Next, Astro, etc.) mounted on the existing dev server.
- One core handler, wrapped by `serve` (node:http), the Vite plugin and Connect middleware.
- **Security:** binds to 127.0.0.1, checks an origin allowlist, requires a token (auto-injected by the Vite plugin), enforces size limits, derives slugs on the server and never uses client-supplied paths.
- Writes are atomic. IDs are ULIDs generated by the server.
- Creates `.field-notes/.gitignore` containing `*` (configurable) so the folder is untracked.
- `serve` also serves the widget's IIFE bundle for script-tag installs.
- **Production safety:** the Vite plugin applies only with `apply: 'serve'`, and the middleware refuses to mount when `NODE_ENV=production` unless forced.

### Future transport adapters (not v1)

The internal `Transport` interface is `(note, attachments) => Promise<Receipt>`. v1 ships two implementations, `local` and `export`. Candidates for later, each additive:

- **http:** webhook or serverless
- **self-hosted collector**
- **work trackers:** GitHub, Jira, Linear

---

## 5. CLI (team and agent side)

```
field-notes serve     [--port 4747] [--dir .field-notes]
field-notes tail      [--json]                  # stream new notes as they arrive (agent-session UX)
field-notes list      [--status open] [--type change] [--author] [--route] [--since 2d] [--group-by route|type|author] [--json]
field-notes show      <id> [--json]
field-notes resolve   <id...> --note "..." [--ref <sha|PR|issue>]
field-notes wontfix   <id...> --note "..."
field-notes reopen    <id>
field-notes import    <export.zip> [--dir .field-notes]   # idempotent; validates every note against the schema
field-notes export    [filters] --format md|json|csv     # digest for a meeting, spec doc, or spreadsheet
field-notes prune     --status resolved --older-than 30d
```

- **`tail`** lets anything consume notes live. For example, an agent session runs it (or polls `list --since`) and acts on each note as it lands. It prints one JSON line per note.
- **`export --format`** produces digests (for example, for requirement gathering): grouped by route or type, with screenshots inlined, ready to paste into a doc or ticket.

---

## 6. Note format (the contract)

```
.field-notes/
  items/
    01JA8X...-checkout-button-misaligned/
      note.md
      screenshot.png
```

```markdown
---
id: 01JA8X3Q7K2M9V5T0N4R6P8W1Y
schema: 1
status: open # open | resolved | wontfix
type: change # bug | change | idea | question | <custom>
author: Sam
created: 2026-10-09T18:42:11.204Z
environment: local
url: http://localhost:5173/checkout?step=2
route: /checkout
title: Checkout — Acme
viewport: { width: 1440, height: 900, dpr: 2 }
element:
  selector: 'form#pay > button.primary'
  text: 'Place order'
  rect: { x: 1102, y: 640, w: 180, h: 44 }
selection: null
screenshot: screenshot.png
context: { appVersion: '1.4.0-dev', gitSha: 'a1b2c3d' }
tags: []
resolution: null
---

The place-order button should say "Start free trial" and the coupon
field should be hidden.
```

- The same JSON shape (frontmatter fields plus `body`) is the sink's request payload, and `note.md` is the same file whether the sink or an export zip wrote it. It is deliberately transport-neutral, so future adapters reuse it unchanged.
- `import` treats zip contents as untrusted. It rejects absolute paths, `..` and symlinks, validates the schema, and enforces size limits.
- There is one directory per item and no shared index, so there are no write conflicts. Anything with file access can read the backlog.
- Readers update only `status`/`resolution`/`tags` and may append `## Notes`.
- `spec/SPEC.md` + `spec/note.schema.json` are versioned. Readers must tolerate unknown fields.

---

## 7. Tech stack and repo layout

The guiding rules: **typed end to end, one source of truth per concept, framework-free logic with a thin UI layer, and nothing hand-rolled where a small, well-maintained library exists.**

### Stack

| concern           | choice                                                                                                                                                                                                                                   | why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| language          | **TypeScript 6.0** (strict, `isolatedDeclarations`), ESM only; pinned below 6.1 until typescript-eslint supports TS 7                                                                                                                    | types are part of the public API; ESM matches every modern host                                                                                                                                                                                                                                                                                                                                                                                                                     |
| monorepo          | **pnpm workspaces** (version pinned via `packageManager` + Corepack)                                                                                                                                                                     | strict dependency isolation, fast CI, the standard for multi-package TS repos                                                                                                                                                                                                                                                                                                                                                                                                       |
| widget UI         | **Lit 3**, bundled privately                                                                                                                                                                                                             | purpose-built for Shadow DOM custom elements shipped into unknown hosts: ~5 KB gz, declarative and reactive, with stable long-term backing. It is **bundled inside our chunk, never a peer dependency**, so it can't conflict with the host's framework or the host's own Lit version. It **only loads when the widget is first opened** (see "Coexisting with the host app"). Preact/Svelte/Solid would each need a custom-element wrapper and bring their own runtime assumptions |
| widget logic      | plain TS modules (capture, metadata, outbox, transports, activation)                                                                                                                                                                     | no UI imports, so the logic is unit-testable and reusable by future adapters (e.g. a browser extension). Lit components are a thin view over it                                                                                                                                                                                                                                                                                                                                     |
| schema            | **Zod 4** as the single source → generated `note.schema.json`                                                                                                                                                                            | one definition gives runtime validation in the browser, sink and CLI, TS types, and the published JSON Schema for non-JS readers. The widget imports `zod/mini` to stay inside its size budget                                                                                                                                                                                                                                                                                      |
| browser libs      | `idb` (IndexedDB), `modern-screenshot`, `fflate` (zip), `@medv/finder` (selectors), `ulid`                                                                                                                                               | small, focused, maintained; screenshot and zip are lazy chunks                                                                                                                                                                                                                                                                                                                                                                                                                      |
| node libs         | built-ins first: `node:http` (no Express), `node:util` `parseArgs` (no commander), `node:fs.watch` recursive (no chokidar); `yaml` bundled                                                                                               | minimal dependency surface for a dev tool                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| install footprint | **zero runtime `dependencies`** in the published package; everything is bundled                                                                                                                                                          | installing `field-notes` adds nothing to the host's dependency tree and can't cause version conflicts or duplicate installs                                                                                                                                                                                                                                                                                                                                                         |
| build             | **tsdown** (Rolldown) for every published entry: browser ESM with the panel as a lazy chunk, the self-contained IIFE script-tag build, Node ESM, bin, and bundled `.d.ts` with workspace types inlined. Vite 8 powers tests and examples | one bundler for the package: tsdown already produces the lazy chunk and the IIFE (code splitting off) beside the Node entries, so Vite library mode would only add a second build pipeline; tsup is no longer actively maintained                                                                                                                                                                                                                                                   |
| quality           | ESLint (flat, typescript-eslint strict) · Prettier · `publint` + `@arethetypeswrong/cli` (package exports correct for every resolver) · size-limit · knip (dead code/deps)                                                               | catches the classic "works in the repo, broken on npm" failures                                                                                                                                                                                                                                                                                                                                                                                                                     |
| release           | **Changesets** → GitHub Actions publish with npm provenance; Renovate for dependency updates                                                                                                                                             |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| runtime support   | Node ≥ 22.18 (Node 20 is EOL, and the toolchain requires 22); evergreen browsers (last 2 Chromium, Firefox, Safari)                                                                                                                      |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### Coexisting with the host app

The widget is a guest in someone else's page. It must not collide with the host's UI stack or styles, and it must not weigh the page down.

**Weight (enforced by size-limit in CI):**

| what                                                          | when it loads               | budget (gz)                        |
| ------------------------------------------------------------- | --------------------------- | ---------------------------------- |
| activation stub: trigger listeners, `open()` API, badge count | at mount                    | **< 3 KB**, with no Lit and no Zod |
| panel: Lit + views + form + `zod/mini`                        | first time the widget opens | < 20 KB                            |
| screenshot (`modern-screenshot`)                              | first screenshot            | lazy                               |
| zip (`fflate`)                                                | first export                | lazy                               |

Until someone opens it, the host pays about 3 KB and a keydown listener. It does no work at mount: no DOM observers and no polling. Production builds that don't activate it tree-shake it away entirely.

**No collisions:**

- **One global name.** Only `<field-notes>` is registered in the global `customElements` registry. Internal UI pieces are Lit templates inside the shadow root, not registered elements, so they can't clash with host tags. Registration is guarded: if the tag already exists (for example, a script tag and the npm import on the same page), the widget reuses it and warns in dev instead of throwing.
- **No shared framework runtime.** Lit is private to our bundle. The widget never touches the host's React/Vue/Solid tree, router or state; it reads the URL and DOM only.
- **Styles are isolated both ways.**
  - **Inward:** a Shadow DOM root, with `:host { all: initial }` to block inherited fonts, colors and line-height.
  - **Outward:** we never inject global stylesheets.
  - **Custom properties:** ours are all namespaced `--field-notes-*`.
  - **Tests:** component tests mount the widget under a deliberately hostile host stylesheet.
- **No z-index wars.** Surfaces render in the browser's top layer (`<dialog>` / the Popover API), so they sit above any host stacking context without a magic z-index.
- **No global side effects.**
  - No polyfills, prototype patching or global CSS.
  - Exactly one global, `window.FieldNotes`, and only in the script-tag build.
  - One exception, once the panel has loaded: Lit's `lit-html` appends its version to `globalThis.litHtmlVersions` (shared with any Lit on the page) and, where Trusted Types exist, creates a `lit-html` policy. A host that enforces Trusted Types must allow that policy name.
  - The opt-in console-error capture chains to the host's existing handlers instead of replacing them, and restores them on `unmount()`.
- **Keyboard etiquette.** The hotkey is configurable, and it's ignored while the host has an editable element focused (unless configured otherwise). The widget never calls `preventDefault` on keys it doesn't own. Focus is trapped only while a surface is open, and returns to the host element that had it.
- **Clean teardown.** `unmount()` removes the element, listeners and timers, so it is safe with HMR and SPA route changes.

### Repo layout

```
packages/
  core/        isomorphic: Zod schema, note (de)serialization, ids, zip read/write — used by every other package
  widget/      browser: logic modules + Lit views; Transport interface, local + export transports
  sink/        node: handler, serve, Vite plugin, Connect middleware
  cli/         node: serve/tail/list/show/resolve/import/export/prune
  field-notes/ the published package: re-exports the above under subpath exports, bundles workspace deps
examples/
  vite-vue/    Vue 3 + Vite plugin; also built in export mode as the "static demo"
  next/        Next.js (React 19) + middleware, server rendering, no Vite
tests/
  e2e/         Playwright specs + a bare HTML fixture for the script-tag/`serve` path (a test fixture, not a showcase example)
docs/
  recipes/     open-ended set, e.g. agent tail session, batch triage, demo prep with export mode, digest to an issue
```

Publish one package, `field-notes`, with subpath exports (`.`, `./sink`, `./vite`, `./middleware`) and a bin. Internal workspace packages are bundled in rather than published separately, so users install one thing and internals can be refactored freely.

**Examples prove integration paths, not frameworks.** Vue covers the Vite plugin plus a custom element used in a template (`isCustomElement`). Next covers middleware, server rendering and React. The widget is framework-independent, so further framework examples would add maintenance without adding coverage.

---

## 8. README structure

1. A one-line pitch and a GIF.
2. **"Some ways people use it":** a short, explicitly non-exhaustive set of examples, each with a 3-line "how" and a recipe link. It is framed so readers see it as a starting point and are invited to add their own. Adding or removing an example never requires changes elsewhere in the README.
3. Install (npm / script tag / Vite plugin / middleware), activation, modes (`local` / `export`).
4. The note format.
5. CLI.
6. **Example: working with coding agents.** a paste-in AGENTS.md / CLAUDE.md / Copilot snippet, plus the `tail` session pattern. Any agent that can run commands works.

---

## 9. Testing ("fully tested")

| layer       | tool                                                                        | covers                                                                                                                                                                                                                                                                                                                                                                     |
| ----------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit        | Vitest (node)                                                               | metadata, selector generation, slugging, ULID, schema, activation (incl. `query`), CLI parsing, frontmatter round-trip, zip writer output                                                                                                                                                                                                                                  |
| component   | **Vitest browser mode** (Playwright provider, real Chromium/Firefox/WebKit) | trigger × surface combinations (hotkey-only → sheet, button → popover, api → side), focus trap and Esc, keyboard and screen-reader accessibility (axe), element lifecycle, Shadow DOM isolation from hostile host CSS, drafts, "My notes" drawer, masking, outbox (real IndexedDB); export-mode badge count, exported state, re-download, retention purge, storage warning |
| delivery    | Vitest                                                                      | local transport against a real sink; retry/backoff; one shared Transport contract suite run against both `local` and `export` (future adapters reuse it)                                                                                                                                                                                                                   |
| sink        | Vitest + real HTTP                                                          | origin/token rejection, size limits, traversal attempts, atomic writes, concurrency, `.gitignore`                                                                                                                                                                                                                                                                          |
| CLI         | Vitest + temp dirs                                                          | every command; `tail` emits on new writes; export formats; `import` idempotency and hostile zips (traversal, symlinks, oversize, invalid schema)                                                                                                                                                                                                                           |
| contract    | Vitest                                                                      | every writer validates against the schema; the sink and an export zip produce equivalent trees for the same note; old-schema fixtures still parse                                                                                                                                                                                                                          |
| docs        | script                                                                      | every command in the README/recipes exists                                                                                                                                                                                                                                                                                                                                 |
| e2e         | Playwright (Chromium, Firefox, WebKit)                                      | `vite-vue`, `next` and the script-tag fixture: capture → pick → screenshot → submit → note lands on disk; sink down → queued → flushed; widget absent from the production build. `vite-vue` export build: `?field-notes=1` → log 3 notes → badge 3 → export → badge 0 → zip downloaded → `import` → 3 valid notes on disk                                                  |
| bundle      | size-limit                                                                  | activation stub < 3 KB gz (asserted to contain no Lit/Zod); panel < 20 KB gz; screenshot and zip chunks lazy; published package has zero runtime dependencies                                                                                                                                                                                                              |
| coexistence | Vitest browser mode                                                         | hostile host CSS; host already using Lit (different version); double registration (script tag + npm); host z-index 2147483647 overlay; host focus trap; `unmount()` leaves no listeners/elements behind                                                                                                                                                                    |
| package     | publint + attw                                                              | exports, types and bin resolve correctly for ESM, bundler and node16 resolution                                                                                                                                                                                                                                                                                            |
| smoke       | `scripts/smoke-pack.mjs`                                                    | the tarball users actually get: zero runtime deps, no `@field-notes/*` leaks in JS or `.d.ts`, subpath imports, bin, nodenext type resolution, README/LICENSE present                                                                                                                                                                                                      |

Real browsers replace happy-dom because Shadow DOM, focus, IndexedDB, clipboard paste and screenshots are exactly what jsdom-style environments fake badly.

**Coverage gates:** 90% lines/branches on `core`, `sink` and `cli`, and 80% on `widget`, enforced in CI. Every bug fix lands with a regression test.

**CI** (GitHub Actions):

- every PR: lint, typecheck, format check, unit and component tests, publint/attw, size-limit and knip
- matrix: Node 22/24 × ubuntu/macos for node packages; Playwright e2e on ubuntu across all three engines
- releases: Changesets with npm provenance

---

## 10. Milestones (tracked as GitHub milestones and issues)

**M0 — Scaffold**

- pnpm workspaces, TypeScript strict, tsdown builds, Vitest (node + browser mode), Playwright, ESLint/Prettier, publint/attw, size-limit, knip, Changesets, Renovate, CI, MIT license
- CONTRIBUTING.md, issue/PR templates, CODE_OF_CONDUCT, SECURITY.md (the sink is a local network listener)
- AGENTS.md with architecture rules, conventions and the quality gate
- pack smoke test: install the packed tarball into a temp project; assert zero runtime deps, no leaked workspace imports, every subpath imports, the bin runs, and types resolve

**M1 — Spec + core** (`packages/core`)

- Zod schema → generated JSON Schema + SPEC.md
- note read/write, ids, zip read/write
- contract tests

**M2 — Widget MVP** (includes a basic "My notes" drawer)

- custom element, triggers (button/hotkey/api), surfaces (popover/sheet/side), drafts, metadata, author, type, activation (`auto`/fn/bool)
- outbox + Transport interface + shared contract tests
- lazy chunks

**M3 — Local sink**

- core handler + local transport
- `serve`, Vite plugin, middleware
- security, atomic writes, widget.js serving

**M3b — Export mode**

- export transport, badge count, "My notes" drawer export, zip + `index.md`
- exported state, re-download, retention, storage warning
- `query` activation
- `field-notes import`

**M4 — Capture extras**

- element picker
- DOM screenshot with masking
- paste/drop
- `display` mode

**M5 — CLI**

- `tail`, `list`, `show`, `resolve`/`wontfix`/`reopen`, `export` (md/json/csv), `prune` (`import` ships in M3b)

**M6 — Examples, recipes, e2e, release**

- `vite-vue` (local + export builds), `next`, script-tag fixture; Playwright matrix
- recipes
- README
- demo GIF
- 1.0.0

**Later:**

- real-time transport adapters for hosted environments: http/webhook, self-hosted collector, GitHub/Jira/Linear
- screenshot annotation
- a browser extension / bookmarklet for apps that can't install the widget
- element → source-file mapping
- interaction breadcrumbs
- an MCP server, if it proves useful

---

## 11. Name

**`field-notes`**: notes taken where the work happens, processed later. The name is free on npm (as of 2026-10-09; the unhyphenated `fieldnotes` is taken). It is used consistently as the package and CLI (`field-notes`), the custom element (`<field-notes>`, a valid custom-element name), the data folder (`.field-notes/`), the dev endpoint (`/__field-notes`), the activation param (`?field-notes=1`) and the mask attribute (`data-field-notes-mask`). Each note's file is `note.md`.

Before publishing, check that the GitHub repo name is free and do a quick trademark sanity check: "Field Notes" is also a notebook brand.

## 12. Open questions

None blocking. The next step is M0.
