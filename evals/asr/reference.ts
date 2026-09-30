type Word = { text: string; startMs: number; endMs: number };

/** Reference words with their midpoint inside [startMs, endMs), times relative to the cut. */
export function referenceWords(utterances: { words: Word[] }[], programStartMs: number, startMs: number, endMs: number): string[] {
  return utterances
    .flatMap((u) => u.words)
    .filter((w) => {
      const mid = (w.startMs + w.endMs) / 2 - programStartMs;
      return mid >= startMs && mid < endMs;
    })
    .map((w) => w.text);
}
