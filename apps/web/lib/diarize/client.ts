import { buildMatchInput, scoreFromSegments, type Anchor } from '../attribution/anchors';

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
  /** Voices are found by a clustering threshold, not a given count: an unexpected voice surfaces for naming. */
  diarize(mono16k: Float32Array): Promise<SpeakerSegment[]> {
    return this.request(mono16k, {});
  }
  /**
   * Callers pass anchors already trimmed with trimAnchor.
   * Share of the utterance spoken by each enrolled voice, 0..1 per anchor key. Anchors and the
   * utterance are diarized together with anchors + 1 clusters; an anchor that lands in a cluster
   * with another anchor scores 0 (see scoreFromSegments).
   */
  async matchVoices(anchors: Anchor[], utterance: Float32Array): Promise<Record<string, number>> {
    const { samples, spans } = buildMatchInput(anchors, utterance);
    const segments = await this.request(samples, { type: 'match', numClusters: anchors.length + 1 });
    return scoreFromSegments(segments, spans);
  }
  private request(mono16k: Float32Array, extra: { type?: 'match'; numClusters?: number }): Promise<SpeakerSegment[]> {
    if (this.dead) return Promise.reject(new Error(STOPPED));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, (r) => (r.ok ? resolve(r.segments ?? []) : reject(new Error(r.error ?? 'speaker separation failed'))));
      // Send a copy: transferring detaches the array and the caller keeps its own for later chunks.
      const samples = mono16k.slice();
      this.worker.postMessage({ id, samples, ...extra }, [samples.buffer]);
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
