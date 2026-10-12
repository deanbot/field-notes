// The capture form: one per open, shared by every surface. Part of the panel
// chunk. State and submit logic live here; the template is a thin view of it.
import type { Note } from '@field-notes/core/note';
import { html, type TemplateResult } from 'lit/html.js';
import { buildNote, resolveAuthor, resolveContext } from './capture.ts';
import { clearDraft, loadDraft, saveDraft } from './drafts.ts';
import type { FieldNotesOptions } from './mount.ts';

const DEFAULT_TYPES: readonly string[] = ['bug', 'change', 'idea', 'question'];

export interface FormDeps {
  readonly options: FieldNotesOptions;
  /** The page's selection when the widget opened. */
  readonly selection: string | undefined;
  readonly consoleErrors: () => readonly string[] | undefined;
  /** Hands the note on. Resolves once it's safely stored; rejects if not. */
  readonly deliver: (note: Note) => Promise<void>;
  /** Aborted on unmount. */
  readonly signal: AbortSignal;
  /** Re-renders the panel after a state change. */
  readonly redraw: () => void;
  readonly focusText: () => void;
  /** After a successful submit: close the panel and confirm. */
  readonly submitted: () => void;
}

export interface Form {
  readonly template: () => TemplateResult;
  readonly submit: () => Promise<void>;
  /** Ctrl/Cmd+Enter submits. Bound on the dialog: WebKit leaves focus there after a chip click. */
  readonly keydown: (event: KeyboardEvent) => void;
}

const isMac = (): boolean => /Mac|iPhone|iPad/.test(navigator.userAgent);

export function createForm(deps: FormDeps): Form {
  const { options } = deps;
  const types = (options.types ?? DEFAULT_TYPES).filter(
    (type) => typeof type === 'string' && type.trim() !== '',
  );
  const draft = loadDraft();
  let text = draft?.text ?? '';
  let type = draft?.type && types.includes(draft.type) ? draft.type : undefined;
  let error = '';
  let busy = false;
  // Started now, so a slow callback has the whole time the form is open.
  const context = resolveContext(options.context, deps.signal);

  const save = (): void => {
    saveDraft({ text, type });
  };

  const submit = async (): Promise<void> => {
    if (busy) return;
    const body = text.trim();
    if (!body) {
      error = 'Write a note first.';
      deps.redraw();
      deps.focusText();
      return;
    }
    busy = true;
    error = '';
    deps.redraw();
    try {
      const note = buildNote({
        body,
        type,
        author: resolveAuthor(options.author),
        environment: options.environment ?? 'local',
        selection: deps.selection,
        context: await context,
        consoleErrors: deps.consoleErrors(),
      });
      await deps.deliver(note);
    } catch (cause) {
      console.warn('[field-notes] the note was not added.', cause);
      busy = false;
      error = "Couldn't add the note. Your text is kept.";
      deps.redraw();
      return;
    }
    if (deps.signal.aborted) return;
    clearDraft();
    deps.submitted();
  };

  const onInput = (event: Event): void => {
    text = (event.target as HTMLTextAreaElement).value;
    if (error && text.trim()) {
      error = '';
      deps.redraw();
    }
    save();
  };
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || event.isComposing) return;
    event.preventDefault();
    void submit();
  };
  const onSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    void submit();
  };
  // Radios can't be unchecked, so a click on the chosen chip clears it.
  // The click lands before `change`, so a new choice still reads as new here.
  const onChipClick = (value: string) => (): void => {
    if (type !== value) return;
    type = undefined;
    save();
    deps.redraw();
  };
  const onChipChange = (value: string) => (): void => {
    type = value;
    save();
    deps.redraw();
  };

  const template = (): TemplateResult =>
    html`<form class="body" novalidate @submit=${onSubmit}>
      <label class="label" for="field-notes-text">Note</label>
      <textarea
        id="field-notes-text"
        name="text"
        rows="5"
        autofocus
        placeholder="What did you notice?"
        aria-invalid=${error ? 'true' : 'false'}
        aria-describedby="field-notes-error"
        .value=${text}
        @input=${onInput}
      ></textarea>
      ${
        types.length
          ? html`<fieldset class="types">
              <legend class="label">Type</legend>
              ${types.map(
                (value) =>
                  html`<label class="chip"
                    ><input
                      type="radio"
                      name="type"
                      .value=${value}
                      .checked=${type === value}
                      @click=${onChipClick(value)}
                      @change=${onChipChange(value)}
                    /><span>${value}</span></label
                  >`,
              )}
            </fieldset>`
          : ''
      }
      <p id="field-notes-error" class="error" role="alert">${error}</p>
      <div class="actions">
        <span class="hint">${isMac() ? '⌘' : 'Ctrl'}+Enter</span>
        <button type="submit" class="primary" ?disabled=${busy}>Add note</button>
      </div>
    </form>`;

  return { template, submit, keydown: onKeydown };
}
