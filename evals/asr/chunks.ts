// Recording chunk size (ruling P3-R12): the production transcription path (planChunks with a 4 s
// overlap, then mergeChunkWords) at 60 s and at 30 s chunks, scored per 60 s window of the cut.

/** One scored 60 s window: reference words, word errors (sub + del + ins) and deletions. */
export type ChunkWindow = { fixture: string; startMs: number; refWords: number; errors: number; deletions: number };
export type ChunkRun = { chunkMs: number; realtimeFactor: number; windows: ChunkWindow[] };

export const pooledWer = (w: ChunkWindow[]) => w.reduce((n, x) => n + x.errors, 0) / Math.max(1, w.reduce((n, x) => n + x.refWords, 0));
const windowWer = (w: ChunkWindow) => (w.refWords ? w.errors / w.refWords : 0);
const round = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * Switch to 30 s only if pooled WER improves by at least 2 points, no scored window gets worse by more
 * than 1 point, and 30 s chunks still run at least 2x real time. Windows pair up by fixture and start.
 */
export function chunkDecision(r60: ChunkRun, r30: ChunkRun) {
  const pooled60 = round(pooledWer(r60.windows));
  const pooled30 = round(pooledWer(r30.windows));
  const at30 = new Map(r30.windows.map((w) => [`${w.fixture}@${w.startMs}`, w]));
  const worstWorsening = round(Math.max(0, ...r60.windows.map((w) => {
    const o = at30.get(`${w.fixture}@${w.startMs}`);
    return o ? windowWer(o) - windowWer(w) : 0;
  })));
  const switchTo30 = pooled60 - pooled30 >= 0.02 - 1e-9 && worstWorsening <= 0.01 + 1e-9 && r30.realtimeFactor >= 2;
  return { pooled60, pooled30, worstWorsening, switchTo30 };
}
