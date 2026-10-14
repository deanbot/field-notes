// "My notes": the notes in this browser's outbox. Part of the panel chunk.
// Pending notes can be edited or deleted; delivered ones are listed as sent.
// In export mode it also exports them, and offers the last export again.
import { html, type TemplateResult } from 'lit/html.js';
import { MAX_AUTHOR, loadAuthor, saveAuthor } from './author.ts';
import type { LoadExport } from './mount.ts';
import { type Outbox, type OutboxEntry, isSending } from './outbox.ts';

/** Export mode's settings; absent in local mode. */
export interface Exporting {
  /** Undefined in the script-tag build, which has no export chunk. */
  readonly load: LoadExport | undefined;
  /** How long the last export can be downloaded again, in ms. */
  readonly retention: number;
  /** Suggest an export at this many unexported notes, or this many bytes. */
  readonly warnAt: { readonly notes: number; readonly bytes: number };
  /** Notes are signed with the name kept in this browser: there's no `author` option. */
  readonly signs: boolean;
}

export interface DrawerDeps {
  readonly outbox: Outbox;
  readonly types: readonly string[];
  readonly redraw: () => void;
  readonly exporting?: Exporting | undefined;
}

/** Roughly what an entry takes in IndexedDB, in bytes. */
const size = (entry: OutboxEntry): number =>
  JSON.stringify(entry.note).length +
  Object.values(entry.attachments).reduce((sum, blob) => sum + blob.size, 0);

export interface Drawer {
  readonly template: () => TemplateResult;
  /** Reads the outbox again and redraws. */
  readonly load: () => Promise<void>;
}

interface Editing {
  readonly id: string;
  body: string;
  type: string | undefined;
}

const firstLine = (body: string): string =>
  body
    .split('\n')
    .find((line) => line.trim())
    ?.trim() ?? '(empty)';

function status(entry: OutboxEntry, exporting: boolean): string {
  if (entry.state === 'delivered') return 'Delivered';
  if (entry.state === 'exported') return 'Exported';
  if (exporting) return 'Not exported yet';
  if (isSending(entry)) return 'Sending…';
  if (entry.rejected) return `Rejected: ${entry.lastError ?? 'unknown error'}`;
  return entry.lastError ? `Not sent yet (${entry.lastError})` : 'Not sent yet';
}

export function createDrawer(deps: DrawerDeps): Drawer {
  const { outbox, exporting } = deps;
  let entries: OutboxEntry[] | undefined;
  let editing: Editing | undefined;
  let error = '';
  let busy = false;
  /** The name being changed, if it is. */
  let renaming: string | undefined;

  const load = async (): Promise<void> => {
    try {
      // The last export past its retention goes before it can be offered.
      if (exporting) await outbox.prune('exported', exporting.retention);
      entries = (await outbox.list()).reverse();
      error = '';
    } catch (cause) {
      console.warn('[field-notes] could not read the outbox.', cause);
      entries = [];
      error = "Couldn't read your notes.";
    }
    deps.redraw();
  };

  const act = async (action: () => Promise<unknown>, failure: string): Promise<void> => {
    let failed = '';
    try {
      await action();
      editing = undefined;
    } catch (cause) {
      console.warn(`[field-notes] ${failure}`, cause);
      failed = failure;
    }
    await load();
    // After the reload, which clears the last error.
    if (failed && !error) {
      error = failed;
      deps.redraw();
    }
  };

  const save = (): void => {
    if (!editing) return;
    const { id, body, type } = editing;
    if (!body.trim()) {
      error = 'A note needs some text.';
      deps.redraw();
      return;
    }
    void act(() => outbox.edit(id, { body: body.trim(), type }), "Couldn't save the change.");
  };

  const item = (entry: OutboxEntry): TemplateResult => {
    if (editing?.id === entry.id) {
      const current = editing;
      return html`<li class="entry">
        <label class="label" for="field-notes-edit">Edit note</label>
        <textarea
          id="field-notes-edit"
          rows="4"
          .value=${current.body}
          @input=${(event: Event) => {
            current.body = (event.target as HTMLTextAreaElement).value;
          }}
        ></textarea>
        ${
          deps.types.length
            ? html`<label class="label" for="field-notes-edit-type">Type</label>
                <select
                  id="field-notes-edit-type"
                  @change=${(event: Event) => {
                    current.type = (event.target as HTMLSelectElement).value || undefined;
                  }}
                >
                  <option value="" ?selected=${!current.type}>None</option>
                  ${deps.types.map(
                    (type) =>
                      html`<option .value=${type} ?selected=${current.type === type}>
                        ${type}
                      </option>`,
                  )}
                </select>`
            : ''
        }
        <div class="actions">
          <button
            type="button"
            class="link"
            @click=${() => {
              editing = undefined;
              error = '';
              deps.redraw();
            }}
          >
            Cancel
          </button>
          <button type="button" class="primary" @click=${save}>Save</button>
        </div>
      </li>`;
    }
    // While it's being sent, the transport has the text as it was.
    const pending = entry.state === 'pending' && !isSending(entry);
    return html`<li class="entry">
      <p class="summary">${firstLine(entry.note.body)}</p>
      <p class="meta">
        ${entry.note.type ? html`<span>${entry.note.type}</span> · ` : ''}<time
          datetime=${entry.note.created}
          >${new Date(entry.note.created).toLocaleString()}</time
        >
        · ${status(entry, !!exporting)}
      </p>
      ${
        pending
          ? html`<div class="actions">
              <button
                type="button"
                class="link"
                aria-label=${`Edit “${firstLine(entry.note.body)}”`}
                @click=${() => {
                  editing = { id: entry.id, body: entry.note.body, type: entry.note.type };
                  error = '';
                  deps.redraw();
                }}
              >
                Edit
              </button>
              <button
                type="button"
                class="link"
                aria-label=${`Delete “${firstLine(entry.note.body)}”`}
                @click=${() => void act(() => outbox.remove(entry.id), "Couldn't delete the note.")}
              >
                Delete
              </button>
            </div>`
          : ''
      }
    </li>`;
  };

  /** Runs an export action, once at a time. */
  const exportAction =
    (run: (mod: Awaited<ReturnType<LoadExport>>) => Promise<unknown>, failure: string) =>
    (): void => {
      if (busy || !exporting) return;
      busy = true;
      deps.redraw();
      void act(async () => {
        if (!exporting.load) throw new Error('this build has no export');
        await run(await exporting.load());
      }, failure).finally(() => {
        busy = false;
        deps.redraw();
      });
    };
  const runExport = exportAction((mod) => mod.exportNotes(outbox), "Couldn't export your notes.");
  const again = exportAction(
    (mod) => mod.downloadLastExport(outbox),
    "Couldn't download the last export.",
  );

  const rename = (value: string | undefined): void => {
    renaming = value;
    error = '';
    deps.redraw();
  };
  const signature = (): TemplateResult => {
    if (renaming !== undefined) {
      return html`<label class="label" for="field-notes-rename">Your name</label>
        <input
          id="field-notes-rename"
          type="text"
          autocomplete="name"
          maxlength=${MAX_AUTHOR}
          .value=${renaming}
          @input=${(event: Event) => {
            renaming = (event.target as HTMLInputElement).value;
          }}
        />
        <p class="meta">
          New notes are signed with it. Leave it blank to be asked on the next note.
        </p>
        <div class="actions">
          <button
            type="button"
            class="link"
            @click=${() => {
              rename(undefined);
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            class="primary"
            @click=${() => {
              saveAuthor(renaming ?? '');
              rename(undefined);
            }}
          >
            Save name
          </button>
        </div>`;
    }
    const name = loadAuthor();
    return html`<div class="actions">
      <p class="meta signed">${name ? `Signed as ${name}` : 'Not signed'}</p>
      <button
        type="button"
        class="link"
        @click=${() => {
          rename(name ?? '');
        }}
      >
        ${name ? 'Change name' : 'Add your name'}
      </button>
    </div>`;
  };

  const exportBar = (settings: Exporting, all: readonly OutboxEntry[]): TemplateResult => {
    const unexported = all.filter((entry) => entry.state === 'pending');
    const bytes = unexported.reduce((sum, entry) => sum + size(entry), 0);
    const last = all.find((entry) => entry.state === 'exported')?.exportedAt;
    // Checked here too: a purge may not have run since it expired.
    const offerAgain = last !== undefined && Date.now() - last < settings.retention;
    const count = unexported.length;
    return html`${settings.signs ? signature() : ''}
      <p class="meta">
        ${
          count
            ? `${String(count)} ${count === 1 ? 'note' : 'notes'} not yet exported, stored only in this browser.`
            : 'Notes stay in this browser until you export them.'
        }
      </p>
      ${
        count >= settings.warnAt.notes || bytes >= settings.warnAt.bytes
          ? html`<p class="warning">
              That's a lot to keep in a browser. Export soon: clearing site data loses them.
            </p>`
          : ''
      }
      <div class="actions">
        ${
          offerAgain
            ? html`<button type="button" class="link" ?disabled=${busy} @click=${again}>
                Download last export again
              </button>`
            : ''
        }
        <button type="button" class="primary" ?disabled=${busy || !count} @click=${runExport}>
          Export (${String(count)})
        </button>
      </div>`;
  };

  const template = (): TemplateResult =>
    html`<div class="body notes">
      <p class="error" role="alert">${error}</p>
      ${exporting && entries ? exportBar(exporting, entries) : ''}
      ${
        entries === undefined
          ? html`<p class="meta">Loading…</p>`
          : entries.length
            ? html`<ul class="entries">
                ${entries.map(item)}
              </ul>`
            : html`<p class="meta">No notes yet.</p>`
      }
    </div>`;

  return { template, load };
}
