export type SpeakerSegment = { startMs: number; endMs: number; label: string; confidence: number };

const STOPPED = 'Speaker separation stopped unexpectedly. Reload the page and try again.';

type Reply = { ok: boolean; segments?: SpeakerSegment[]; error?: string };

export class DiarizeClient {
  private seq = 0;
  private waiting = new Map<number, (r: Reply) => void>();
  /** Set once the worker has errored or been terminated: it will never answer again. */
  private dead = false;
  private constructor(private readonly worker: Worker) {}
  static load(): Promise<DiarizeClient> {
    const w = new Worker('/sherpa/diarize-worker.js');
    const c = new DiarizeClient(w);
    return new Promise((resolve, reject) => {
      const fail = (err: Error) => { clearTimeout(t); w.terminate(); reject(err); };
      const t = setTimeout(() => fail(new Error('Speaker separation did not load. Reload the page and try again.')), 120_000);
      w.onmessage = (e: MessageEvent<{ ready?: boolean }>) => {
        if (e.data.ready) {
          clearTimeout(t);
          w.onmessage = (m: MessageEvent<Reply & { id: number }>) => {
            c.waiting.get(m.data.id)?.(m.data);
            c.waiting.delete(m.data.id);
          };
          w.onerror = () => c.failAll();
          resolve(c);
        }
      };
      w.onerror = (e) => fail(new Error(e.message || 'Speaker separation could not start.'));
    });
  }
  diarize(mono16k: Float32Array, numSpeakers: number | null): Promise<SpeakerSegment[]> {
    if (this.dead) return Promise.reject(new Error(STOPPED));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, (r) => (r.ok ? resolve(r.segments ?? []) : reject(new Error(r.error ?? 'speaker separation failed'))));
      // Send a copy: transferring detaches the array and the caller keeps its own for later chunks.
      const samples = mono16k.slice();
      this.worker.postMessage({ id, samples, numSpeakers }, [samples.buffer]);
    });
  }
  private failAll() {
    this.dead = true;
    const pending = [...this.waiting.values()];
    this.waiting.clear();
    for (const f of pending) f({ ok: false, error: STOPPED });
  }
  terminate() {
    this.worker.terminate();
    this.failAll();
  }
}
