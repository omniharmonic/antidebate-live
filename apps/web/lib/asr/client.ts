import type { Word } from './chunks';
import { browserSupport } from './browser-support';
import type { DownloadReport } from './progress';
import type { LoadErrorKind } from './load-error';
import { ASR_VARIANT, isCached, type AsrVariant } from './variant';

/** A model load failure, with whether it was the download or the model starting. */
export class AsrLoadError extends Error {
  constructor(message: string, readonly kind: LoadErrorKind) {
    super(message);
  }
}

export type AsrProgress = DownloadReport;

export class AsrClient {
  private seq = 0;
  private stopped: Error | null = null;
  private waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; progress?: (p: AsrProgress) => void }>();
  backend: 'wasm' = 'wasm';

  private constructor(private readonly worker: Worker) {
    worker.onmessage = (e: MessageEvent<{ id: number; ok?: boolean; error?: string; errorKind?: LoadErrorKind; progress?: AsrProgress } & Record<string, unknown>>) => {
      const w = this.waiting.get(e.data.id);
      if (!w) return;
      if (e.data.progress) return w.progress?.(e.data.progress);
      this.waiting.delete(e.data.id);
      if (e.data.ok) w.resolve(e.data);
      else w.reject(e.data.errorKind ? new AsrLoadError(e.data.error ?? 'model failed to load', e.data.errorKind) : new Error(e.data.error ?? 'transcription failed'));
    };
    worker.onerror = (e) => {
      this.failAll(new Error(e.message || 'The transcription worker stopped. Reload the page to restart it.'));
    };
  }

  private send<T>(msg: object, transfer: Transferable[] = [], progress?: (p: AsrProgress) => void): Promise<T> {
    if (this.stopped) return Promise.reject(this.stopped);
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject, ...(progress ? { progress } : {}) });
      try {
        this.worker.postMessage({ id, ...msg }, transfer);
      } catch (error) {
        this.waiting.delete(id);
        reject(error);
      }
    });
  }

  static async load(onProgress?: (p: AsrProgress) => void): Promise<AsrClient> {
    const worker = new Worker(new URL('./asr.worker.ts', import.meta.url), { type: 'module' });
    const c = new AsrClient(worker);
    try {
      const r = await c.send<{ backend: 'wasm' }>({ kind: 'load', variant: ASR_VARIANT }, [], onProgress);
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

  private failAll(error: Error) {
    this.stopped = error;
    for (const w of this.waiting.values()) w.reject(error);
    this.waiting.clear();
  }

  terminate() {
    this.worker.terminate();
    this.failAll(new Error('Transcription stopped. Reload the page to restart it.'));
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
  const variant = ASR_VARIANT;
  const persisted = (await navigator.storage?.persisted?.()) ?? false;
  const modelCached = await modelIsCached(variant);
  return { browserOk, variant, modelCached, persisted };
}
