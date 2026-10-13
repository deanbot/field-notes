// The outbox database for tests that go through it end to end.
import { DB_NAME, createOutbox } from './outbox.ts';

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => {
      resolve();
    };
    request.onerror = () => {
      reject(request.error ?? new Error('delete failed'));
    };
  });
}

/**
 * Deletes the outbox database and creates it again, empty. Creating it can
 * take Firefox a second on a busy CI runner, longer than a test waits for a
 * submit; here it's inside the hook's timeout instead.
 */
export async function resetDatabase(): Promise<void> {
  await deleteDatabase();
  const controller = new AbortController();
  try {
    await createOutbox(controller.signal).pendingCount();
  } finally {
    controller.abort();
  }
}
