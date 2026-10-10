# field-notes — Agent Instructions

## What this repo is

`field-notes` is a drop-in widget for capturing in-context feedback in any web app, plus the local tooling (sink, CLI) that stores notes as files in a project. [PLAN.md](./PLAN.md) is the design source of truth: scope, architecture, note format, milestones. Read the relevant section before starting an issue.

## Architecture rules

- **Only `packages/field-notes` is published.** The `@field-notes/*` packages are private and bundled into it. The published package must keep **zero runtime dependencies**, and `pnpm smoke` enforces this.
- **Runtime boundaries:** `core` is isomorphic (no DOM, no Node built-ins); `widget` is browser-only; `sink` and `cli` are Node-only.
- **The widget is a guest in someone else's page.**
  - Register only the `<field-notes>` element; no global CSS or other globals.
  - Bundle Lit privately; never make it a peer dependency.
  - Keep the activation stub within its size budget, and lazy-load everything else.
  - See "Coexisting with the host app" in PLAN.md.
- **Logic stays out of UI components.** Widget logic lives in plain TypeScript modules; Lit components are a thin view over them.
- **The note format is a contract.** Changes to the schema need a `SCHEMA_VERSION` decision and contract tests.
- **Use cases are examples, never an exhaustive list.** Persona names don't belong in the schema, config, CLI flags or defaults.

## Conventions

- TypeScript strict with `isolatedDeclarations`: exported functions need explicit return types.
- Tests sit next to the code (`*.test.ts`). Widget tests run in real browsers (Vitest browser mode).
- Every bug fix includes a regression test. Coverage thresholds are enforced (90% core/sink/cli, 80% widget).
- Add a changeset (`pnpm changeset`) for user-visible changes to `field-notes`.
- Commits are terse, one line where possible. If the work is for a GitHub issue, tag it (`#12`). No AI or tool attribution trailers (no `Co-Authored-By`, no "Generated with").
- PR descriptions are terse and durable: what changed and why, in a form that stays true after merge. No attribution.
- Run commands through the pinned pnpm (`corepack pnpm …` if Corepack isn't enabled).

## Agent loop

repo: deanbot/field-notes
in-progress-label: in-progress
quality-gates: pnpm verify

`pnpm verify` runs build, typecheck, lint, format check, tests with coverage, package checks, size budgets, knip and the pack smoke test.
