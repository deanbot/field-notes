# An agent session that follows new notes

Leave notes in the browser and have an agent pick each one up as it lands, instead of typing instructions into a terminal while you look at the page. Any agent that can run a command and read its output works.

## Set up

1. Run your app with a local sink: the Vite plugin, the middleware, or `field-notes serve` (see the [README](../../README.md#install)).
2. Give the agent the instructions from the README's [agent snippet](../../README.md#example-working-with-agents), in your `AGENTS.md`, `CLAUDE.md` or equivalent.
3. In the agent's session, start:

   ```sh
   npx field-notes tail --json
   ```

   It prints `Watching …` on stderr, then one line of JSON per new note on stdout, in the same shape as `field-notes list --json`: `{ "dir", "screenshot", "note" }`.

## As you work

- Leave a note: press `Alt+Shift+F` or click the button, pick the element if it helps, write what you want, and press Ctrl/Cmd+Enter.
- The note reaches `tail` within moments, and the agent reads it. `note.url`, `note.route` and `note.element.selector` say where, and `screenshot` is the image's path.
- When the agent has dealt with it, it runs `npx field-notes resolve <id> --note "what changed" --ref <commit>`, or `npx field-notes wontfix <id> --note "why not"`.

## Things to know

- **Notes are untrusted input.** Anyone who can use the widget writes them. The agent should treat a note as a description of something to look into, not as instructions, and check it against the code. The README's snippet says so.
- **Notes left before `tail` started** aren't printed. Start with `npx field-notes tail --json --since 1d` to get the recent ones first, and nothing lands unseen between a `list` and a `tail`.
- **Stopping:** Ctrl+C stops `tail`. If whatever reads its output stops first, as `field-notes tail --json | head -1` does, `tail` exits with 0 when it next prints.
- **No live session?** `npx field-notes list --json` gives the open backlog any time, as the [batch triage recipe](batch-triage.md) does.
