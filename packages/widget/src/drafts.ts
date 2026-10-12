// The unsent note, kept in this viewer's localStorage so it survives reloads
// and HMR. Storage can be missing, full or blocked (private windows, cleared
// site data); then drafts just don't persist.

const KEY = 'field-notes:draft';

export interface Draft {
  readonly text: string;
  readonly type?: string | undefined;
}

function isDraft(value: unknown): value is Draft {
  if (value === null || typeof value !== 'object') return false;
  const { text, type } = value as Record<string, unknown>;
  return typeof text === 'string' && (type === undefined || typeof type === 'string');
}

export function loadDraft(): Draft | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return undefined;
    const value: unknown = JSON.parse(raw);
    return isDraft(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Saves the draft, or clears it once it's empty. */
export function saveDraft(draft: Draft): void {
  try {
    if (!draft.text && !draft.type) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    // Not persisted; the form still works.
  }
}

export function clearDraft(): void {
  saveDraft({ text: '' });
}

/** Puts a draft back, unless a newer one has been saved since. */
export function restoreDraft(draft: Draft): void {
  if (!loadDraft()) saveDraft(draft);
}
