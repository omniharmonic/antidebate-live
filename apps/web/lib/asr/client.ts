import type { Word } from './chunks';
import { browserSupport } from './browser-support';
import type { DownloadReport } from './progress';
import { chooseVariant, isCached, type AsrVariant } from './variant';

type NavigatorGpu = { gpu?: Parameters<typeof chooseVariant>[0] };
/** The Parakeet build for this laptop (see variant.ts). */
export const laptopVariant = () => chooseVariant(typeof navigator === 'undefined' ? undefined : (navigator as NavigatorGpu).gpu);

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
    const variant = await laptopVariant();
    const worker = new Worker(new URL('./asr.worker.ts', import.meta.url), { type: 'module' });
    const c = new AsrClient(worker);
    try {
      const r = await c.send<{ backend: 'webgpu' | 'wasm' }>({ kind: 'load', variant }, [], onProgress);
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

  /**
   * Measures the real-time factor on this laptop: 5 s untimed first (the first run compiles
   * shaders and allocates buffers), then 30 s timed. A steady tone, so no speech is needed.
   */
  async benchmark(): Promise<{ realtimeFactor: number }> {
    const tone = (seconds: number) => {
      const pcm = new Float32Array(16_000 * seconds);
      for (let i = 0; i < pcm.length; i++) pcm[i] = 0.05 * Math.sin((2 * Math.PI * 220 * i) / 16_000);
      return pcm;
    };
    await this.transcribe(tone(5), 0);
    const timed = tone(30);
    const t0 = performance.now();
    await this.transcribe(timed, 0);
    return { realtimeFactor: 30_000 / Math.max(1, performance.now() - t0) };
  }

  terminate() {
    this.worker.terminate();
  }
}

/** True when parakeet.js has already stored this variant's files in this browser (its IndexedDB cache). */
async function modelIsCached(variant: AsrVariant): Promise<boolean> {
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
        keys.onsuccess = () => resolve(isCached(variant, keys.result.map(String)));
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

export async function readiness(): Promise<{ browserOk: boolean; variant: AsrVariant; modelCached: boolean; persisted: boolean }> {
  const browserOk = browserSupport(navigator.userAgent);
  const variant = await laptopVariant();
  const persisted = (await navigator.storage?.persisted?.()) ?? false;
  const modelCached = await modelIsCached(variant);
  return { browserOk, variant, modelCached, persisted };
}
