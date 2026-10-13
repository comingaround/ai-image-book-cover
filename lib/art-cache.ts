'use client';

/**
 * Saved AI illustrations, in the visitor's own browser (IndexedDB — localStorage
 * caps at ~5 MB of text, one illustration is 1–2 MB of image). Keyed by a
 * fingerprint of the photo's bytes + the style, so the same photo in the same
 * style never pays for a second generation, even after closing the tab.
 *
 * Every call swallows its errors and acts as a miss: private windows, blocked
 * storage or a full disk must cost a generation, never break the page.
 */

const DB = 'baby-book';
const STORE = 'art';
const KEEP = 30; // newest entries kept; older ones are evicted

interface Entry {
  key: string;
  blob: Blob;
  usedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

/** SHA-256 of the file's bytes: the same photo re-uploaded gets the same key. */
export async function fingerprint(file: Blob): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

export const artKey = (photoHash: string, style: string) => `${photoHash}:${style}`;

export async function loadArt(key: string): Promise<Blob | null> {
  try {
    const hit = await run<Entry | undefined>('readonly', (s) => s.get(key));
    if (!hit) return null;
    void run('readwrite', (s) => s.put({ ...hit, usedAt: Date.now() })).catch(() => {});
    return hit.blob;
  } catch {
    return null;
  }
}

export async function saveArt(key: string, blob: Blob): Promise<void> {
  try {
    await run('readwrite', (s) => s.put({ key, blob, usedAt: Date.now() } satisfies Entry));
    const all = await run<Entry[]>('readonly', (s) => s.getAll());
    const stale = all.sort((a, b) => b.usedAt - a.usedAt).slice(KEEP);
    await Promise.all(stale.map((e) => run('readwrite', (s) => s.delete(e.key))));
  } catch {
    // Storage unavailable or full: the illustration still works, it just isn't saved.
  }
}
