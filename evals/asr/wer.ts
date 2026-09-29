// Word error rate: word-level Levenshtein distance over lowercase, punctuation-stripped tokens,
// divided by the reference length. An empty reference scores 0 against an empty hypothesis, else 1.
export function tokens(text: string): string[] {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/'/g, '').split(/\s+/).filter(Boolean);
}

export function wer(ref: string, hyp: string): number {
  const r = tokens(ref);
  const h = tokens(hyp);
  if (r.length === 0) return h.length === 0 ? 0 : 1;
  let prev = Array.from({ length: h.length + 1 }, (_, j) => j);
  for (let i = 1; i <= r.length; i++) {
    const row = [i];
    for (let j = 1; j <= h.length; j++) row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (r[i - 1] === h[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[h.length]! / r.length;
}
