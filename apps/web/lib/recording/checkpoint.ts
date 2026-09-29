/**
 * Per-session progress on this device (spec §6.4): the outbox of events not yet
 * uploaded, each transcribed chunk, and the speaker map. One IndexedDB database per
 * session, so closing the tab pauses a recording rather than losing it.
 */
import type { DomainEvent } from '@adl/core';
import type { OutboxStore } from '@adl/engine';
import type { Word } from '@/lib/asr/chunks';
import type { SpeakerSegment } from '@/lib/diarize/client';

/** `transcribed`: every chunk has been emitted to the log, so analysis can resume without the file. */
export type RecordingMeta = { fileName: string; fileSize: number; durationMs: number; segments: SpeakerSegment[]; voiceMap: Record<string, string | null>; transcribed?: boolean };

function open(sessionId: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(`adl-host-${sessionId}`, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function get<T>(db: IDBDatabase, key: string): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const q = db.transaction('kv').objectStore('kv').get(key);
    q.onsuccess = () => resolve((q.result as T | undefined) ?? null);
    q.onerror = () => reject(q.error);
  });
}

async function put(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = db.transaction('kv', 'readwrite');
    t.objectStore('kv').put(value, key);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

/** Deletes every transcribed chunk (the recording changed). */
async function clearChunks(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = db.transaction('kv', 'readwrite');
    t.objectStore('kv').delete(IDBKeyRange.bound('chunk:', 'chunk:\uffff'));
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function idbCheckpoint(sessionId: string) {
  const db = await open(sessionId);
  const outbox: OutboxStore = {
    load: async () => (await get<DomainEvent[]>(db, 'outbox')) ?? [],
    save: (p) => put(db, 'outbox', p),
  };
  return {
    outbox,
    getChunk: (i: number) => get<Word[]>(db, `chunk:${i}`),
    putChunk: (i: number, w: Word[]) => put(db, `chunk:${i}`, w),
    clearChunks: () => clearChunks(db),
    getMeta: () => get<RecordingMeta>(db, 'meta'),
    putMeta: (m: RecordingMeta) => put(db, 'meta', m),
    close: () => db.close(),
  };
}
export type Checkpoint = Awaited<ReturnType<typeof idbCheckpoint>>;
