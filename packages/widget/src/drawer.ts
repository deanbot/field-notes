// "My notes": the notes in this browser's outbox. Part of the panel chunk.
// Pending notes can be edited or deleted; delivered ones are listed as sent.
import { html, type TemplateResult } from 'lit/html.js';
import type { Outbox, OutboxEntry } from './outbox.ts';

export interface DrawerDeps {
  readonly outbox: Outbox;
  readonly types: readonly string[];
  readonly redraw: () => void;
}

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

function status(entry: OutboxEntry): string {
  if (entry.state === 'delivered') return 'Delivered';
  if (entry.state === 'exported') return 'Exported';
  if (entry.rejected) return `Rejected: ${entry.lastError ?? 'unknown error'}`;
  return entry.lastError ? `Not sent yet (${entry.lastError})` : 'Not sent yet';
}

export function createDrawer(deps: DrawerDeps): Drawer {
  const { outbox } = deps;
  let entries: OutboxEntry[] | undefined;
  let editing: Editing | undefined;
  let error = '';

  const load = async (): Promise<void> => {
    try {
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
    try {
      await action();
      editing = undefined;
      error = '';
    } catch (cause) {
      console.warn(`[field-notes] ${failure}`, cause);
      error = failure;
    }
    await load();
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
    const pending = entry.state === 'pending';
    return html`<li class="entry">
      <p class="summary">${firstLine(entry.note.body)}</p>
      <p class="meta">
        ${entry.note.type ? html`<span>${entry.note.type}</span> · ` : ''}<time
          datetime=${entry.note.created}
          >${new Date(entry.note.created).toLocaleString()}</time
        >
        · ${status(entry)}
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

  const template = (): TemplateResult =>
    html`<div class="body notes">
      <p class="error" role="alert">${error}</p>
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
