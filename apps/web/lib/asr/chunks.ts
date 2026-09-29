export type Word = { text: string; startMs: number; endMs: number; confidence?: number };

export function planChunks(totalMs: number, windowMs = 60_000, overlapMs = 4_000) {
  if (windowMs <= overlapMs) {
    throw new RangeError(`windowMs (${windowMs}) must be greater than overlapMs (${overlapMs})`);
  }
  const out: { index: number; startMs: number; endMs: number }[] = [];
  for (let start = 0, i = 0; start < totalMs; start += windowMs - overlapMs, i++) {
    out.push({ index: i, startMs: start, endMs: Math.min(totalMs, start + windowMs) });
    if (start + windowMs >= totalMs) break;
  }
  return out;
}

/** In an overlap, each chunk owns the half nearest its own centre; a word goes to the chunk that owns its midpoint. */
export function mergeChunkWords(chunks: { startMs: number; endMs: number; words: Word[] }[]): Word[] {
  const sorted = [...chunks].sort((a, b) => a.startMs - b.startMs);
  const out: Word[] = [];
  sorted.forEach((c, i) => {
    const prev = sorted[i - 1];
    const next = sorted[i + 1];
    const from = prev ? (c.startMs + prev.endMs) / 2 : -Infinity;
    const to = next ? (next.startMs + c.endMs) / 2 : Infinity;
    for (const w of c.words) {
      const mid = (w.startMs + w.endMs) / 2;
      if (mid >= from && mid < to) out.push(w);
    }
  });
  return out;
}
