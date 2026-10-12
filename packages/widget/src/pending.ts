// The outbox's pending count, mirrored to localStorage so the stub can show
// the badge at mount without opening IndexedDB. Other tabs see changes as
// storage events.

export const PENDING_KEY = 'field-notes:pending';

export function writePending(count: number): void {
  try {
    if (count > 0) localStorage.setItem(PENDING_KEY, String(count));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    // The badge just won't persist it.
  }
}

export function readPending(): number {
  try {
    const count = Number(localStorage.getItem(PENDING_KEY));
    return Number.isInteger(count) && count > 0 ? count : 0;
  } catch {
    return 0;
  }
}
