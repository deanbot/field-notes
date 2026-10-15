# Contributing

Thanks for helping out. This guide covers setup, the repo layout, and the bar a change has to clear.

## Setup

Requirements: Node 22.18+ (see `.nvmrc`) and [Corepack](https://nodejs.org/api/corepack.html), which provides the pinned pnpm version from `package.json`.

```sh
corepack enable          # once per machine; or prefix commands with `corepack`
pnpm install
pnpm exec playwright install chromium   # add firefox webkit to run every engine locally
```

## Commands

| command                                                                   | what it does                                                                                                                          |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm build`                                                              | builds the published `field-notes` package into `packages/field-notes/dist`                                                           |
| `pnpm typecheck`                                                          | `tsc` across all packages and tooling config                                                                                          |
| `pnpm lint` / `pnpm format`                                               | ESLint (type-aware) / Prettier                                                                                                        |
| `pnpm test`                                                               | Vitest: Node project plus a real-browser project (Chromium by default)                                                                |
| `pnpm test:coverage`                                                      | the same, with coverage thresholds enforced                                                                                           |
| `BROWSERS=chromium,firefox,webkit pnpm exec vitest run --project browser` | browser tests on every engine                                                                                                         |
| `pnpm check:package`                                                      | publint + are-the-types-wrong against the packed package                                                                              |
| `pnpm size`                                                               | bundle-size budgets                                                                                                                   |
| `pnpm knip`                                                               | unused files, exports and dependencies                                                                                                |
| `pnpm smoke`                                                              | packs the package, installs it into a temp project, and checks imports, bin and types                                                 |
| `pnpm check:docs`                                                         | fails if the docs mention a CLI command, CLI option, widget option, script tag attribute or file that doesn't exist                   |
| `pnpm e2e`                                                                | builds the package and the examples, then runs the Playwright e2e tests in `tests/e2e` (needs Chromium, Firefox and WebKit installed) |
| `pnpm demo:gif`                                                           | records `docs/demo.gif` from `examples/vite-vue` (run `pnpm build` first; needs ffmpeg)                                               |
| `pnpm verify`                                                             | everything above, in CI order. Run it before opening a PR                                                                             |

## Repo layout

```
packages/
  core/         isomorphic: note schema, (de)serialization, ids
  widget/       browser: logic modules plus Lit views
  sink/         node: local server, Vite plugin, middleware
  cli/          node: the `field-notes` command
  field-notes/  the only published package; bundles the others
```

The `@field-notes/*` packages are private. They are bundled into `field-notes` at build time, so the published package has **zero runtime dependencies**. Don't add a runtime `dependency` to `field-notes`; bundle it instead, and justify its size.

## The bar for changes

- **Tests.** New behaviour comes with tests, and bug fixes include a regression test. Coverage thresholds: 90% for `core`, `sink` and `cli`; 80% for `widget`.
- **Real browsers for widget code.** Component tests run in Vitest browser mode (Playwright), not a simulated DOM.
- **Be a good guest.** The widget runs inside other people's apps. No global CSS, no globals beyond the documented ones, no polyfills, and size budgets are enforced. See "Coexisting with the host app" in [PLAN.md](./PLAN.md).
- **Explicit types on exports.** `isolatedDeclarations` is on, so exported functions need explicit return types.
- **Changesets.** If users of `field-notes` will notice a change, add one with `pnpm changeset`.

## Releasing (maintainers)

Releases are **off by default**. The Release workflow only runs when the `RELEASE_ENABLED` repository variable is `true`, so pushes to `main` before 1.0 can't publish a placeholder.

Once enabled, merging to `main` runs the Release workflow. If there are pending changesets, it opens or updates a "chore: release" PR. Merging that PR publishes to npm with provenance.

One-time setup:

- add an `NPM_TOKEN` repository secret (an npm automation token)
- set the `RELEASE_ENABLED` repository variable to `true` when ready to publish
