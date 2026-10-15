# field-notes

_Rapid, in-context feedback capture for any web app._

> **Status: in development, not yet published.** The design lives in [PLAN.md](./PLAN.md).

field-notes lets anyone using an app jot down what they want changed, right where they see it, without switching context. A small drop-in widget opens from a hotkey, a floating button or the host app's own UI. Each note carries its own context (URL, the element you picked, a screenshot, who wrote it), so whoever acts on it later doesn't need to be told where you were or what you meant.

Notes are saved as plain files in your project (`.field-notes/items/<id>/note.md` plus a screenshot), ready to be worked through in a batch whenever you choose, or as they come in: by you, a teammate, or an agent.

## Highlights (planned for 1.0)

- **Framework-agnostic.** One custom element in its own Shadow DOM. It works in React, Vue, Svelte, Solid, Angular, server-rendered apps and plain HTML, without touching your app's UI stack or styles.
- **Light.** About 3.5 KB until it's first opened. Zero runtime dependencies.
- **Local-first.** Notes go to a tiny local server, Vite plugin or dev middleware that writes them into your repo. Or keep them in the browser and export a zip, which is handy for demo and staging builds.
- **Context included.** URL, route, viewport, selected text, a picked element's selector, an optional screenshot, plus anything your app adds.
- **Readable by people and tools.** Markdown with YAML frontmatter and a published JSON Schema, plus a CLI to list, filter, resolve and export notes.

## Some ways people use it

These are examples, not a complete list:

- Walking through your own app and capturing changes as you go, then handling them in one batch.
- Feeding a coding agent: the agent tails new notes, or works through the backlog later.
- Reviewing freshly implemented pages with a team.
- Preparing a demo and noting what should change before it, which feeds work management and requirement gathering.

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
