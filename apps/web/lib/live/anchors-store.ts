/**
 * The enrollment anchors and setup for one live session, kept on this device so a reload
 * mid-debate resumes with the same voices and channel map. Same one-database-per-session
 * pattern as recording/checkpoint.ts, with the keys `anchors`, `setup`, `capture` and `startedAt`.
 */
import type { Anchor } from '../attribution/anchors';
import type { CaptureSpec } from './capture';
import type { LiveSetup } from './runner';

type StoredAnchor = { key: string; pcm: ArrayBuffer };
/** `startedAt` (epoch ms) is session time zero: capture after a pause or reload continues from wall time. */
export type LiveState = { setup: LiveSetup; anchors: Anchor[]; capture?: CaptureSpec; startedAt?: number };

function open(sessionId: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(`adl-live-${sessionId}`, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function get<T>(db: IDBDatabase, key: string): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const q = db.transaction('kv').objectStore('kv').get(key);
    q.onsuccess = () => resolve((q.result as T | undefined) ?? null);
    q.onerror = () => reject(q.error);
  });
}

function put(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = db.transaction('kv', 'readwrite');
    t.objectStore('kv').put(value, key);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function idbAnchorsStore(sessionId: string) {
  const db = await open(sessionId);
  return {
    save: async (s: LiveState): Promise<void> => {
      await put(db, 'setup', s.setup);
      // Copy each clip so the stored buffer is exactly its samples, not a view onto a larger one.
      await put(db, 'anchors', s.anchors.map((a): StoredAnchor => ({ key: a.key, pcm: a.pcm.slice().buffer })));
      if (s.capture) await put(db, 'capture', s.capture);
      if (s.startedAt !== undefined) await put(db, 'startedAt', s.startedAt);
    },
    load: async (): Promise<LiveState | null> => {
      const setup = await get<LiveSetup>(db, 'setup');
      const anchors = await get<StoredAnchor[]>(db, 'anchors');
      if (!setup || !anchors) return null;
      const capture = await get<CaptureSpec>(db, 'capture');
      const startedAt = await get<number>(db, 'startedAt');
      return { setup, anchors: anchors.map((a) => ({ key: a.key, pcm: new Float32Array(a.pcm) })), ...(capture ? { capture } : {}), ...(startedAt !== null ? { startedAt } : {}) };
    },
    close: () => db.close(),
  };
}
