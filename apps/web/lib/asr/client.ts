import type { Word } from './chunks';
import { browserSupport } from './browser-support';
import type { DownloadReport } from './progress';

export type AsrProgress = DownloadReport;

export class AsrClient {
  private seq = 0;
  private waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; progress?: (p: AsrProgress) => void }>();
  backend: 'webgpu' | 'wasm' = 'wasm';

  private constructor(private readonly worker: Worker) {
    worker.onmessage = (e: MessageEvent<{ id: number; ok?: boolean; error?: string; progress?: AsrProgress } & Record<string, unknown>>) => {
      const w = this.waiting.get(e.data.id);
      if (!w) return;
      if (e.data.progress) return w.progress?.(e.data.progress);
      this.waiting.delete(e.data.id);
      if (e.data.ok) w.resolve(e.data);
      else w.reject(new Error(e.data.error ?? 'transcription failed'));
    };
    worker.onerror = (e) => {
      const err = new Error(e.message || 'The transcription worker stopped.');
      for (const w of this.waiting.values()) w.reject(err);
      this.waiting.clear();
    };
  }

  private send<T>(msg: object, transfer: Transferable[] = [], progress?: (p: AsrProgress) => void): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject, ...(progress ? { progress } : {}) });
      this.worker.postMessage({ id, ...msg }, transfer);
    });
  }

  static async load(onProgress?: (p: AsrProgress) => void): Promise<AsrClient> {
    const worker = new Worker(new URL('./asr.worker.ts', import.meta.url), { type: 'module' });
    const c = new AsrClient(worker);
    try {
      const r = await c.send<{ backend: 'webgpu' | 'wasm' }>({ kind: 'load' }, [], onProgress);
      c.backend = r.backend;
      return c;
    } catch (err) {
      worker.terminate();
      throw err;
    }
  }

  async transcribe(pcm: Float32Array, offsetMs: number): Promise<Word[]> {
    const copy = pcm.slice();
    return (await this.send<{ words: Word[] }>({ kind: 'transcribe', pcm: copy, offsetMs }, [copy.buffer])).words;
  }

  /** 30 s of a steady tone: measures the real-time factor on this laptop. */
  async benchmark(): Promise<{ realtimeFactor: number }> {
    const pcm = new Float32Array(16_000 * 30);
    for (let i = 0; i < pcm.length; i++) pcm[i] = 0.05 * Math.sin((2 * Math.PI * 220 * i) / 16_000);
    const t0 = performance.now();
    await this.transcribe(pcm, 0);
    return { realtimeFactor: 30_000 / (performance.now() - t0) };
  }

  terminate() {
    this.worker.terminate();
  }
}

/** True when parakeet.js has already stored the model files in this browser (its IndexedDB cache). */
async function modelIsCached(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false;
  return new Promise<boolean>((resolve) => {
    const req = indexedDB.open('parakeet-cache-db');
    req.onupgradeneeded = () => { req.transaction?.abort(); resolve(false); }; // did not exist; do not create it
    req.onerror = () => resolve(false);
    req.onsuccess = () => {
      const db = req.result;
      try {
        if (!db.objectStoreNames.contains('file-store')) return resolve(false);
        const keys = db.transaction('file-store', 'readonly').objectStore('file-store').getAllKeys();
        keys.onsuccess = () => resolve(keys.result.filter((k) => String(k).startsWith('hf-ysdede/parakeet-tdt-0.6b-v3')).length >= 3);
        keys.onerror = () => resolve(false);
      } catch {
        resolve(false);
      } finally {
        // getAllKeys keeps the transaction alive; closing after queueing is safe.
        db.close();
      }
    };
  });
}

export async function readiness(): Promise<{ browserOk: boolean; webgpu: boolean; modelCached: boolean; persisted: boolean }> {
  const browserOk = browserSupport(navigator.userAgent);
  const webgpu = 'gpu' in navigator;
  const persisted = (await navigator.storage?.persisted?.()) ?? false;
  const modelCached = await modelIsCached();
  return { browserOk, webgpu, modelCached, persisted };
}
