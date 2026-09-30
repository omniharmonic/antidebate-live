// Word error rate: word-level Levenshtein distance over lowercase, punctuation-stripped tokens,
// divided by the reference length. An empty reference scores 0 against an empty hypothesis, else 1.
export function tokens(text: string): string[] {
  return text.toLowerCase().replace(/[\u2019\u2018]/g, "'").replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/'/g, '').split(/\s+/).filter(Boolean);
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

/** The same alignment as `wer`, split into substitutions, deletions (reference words missing) and insertions. */
export function werCounts(ref: string, hyp: string): { refWords: number; sub: number; del: number; ins: number } {
  const r = tokens(ref);
  const h = tokens(hyp);
  const d: number[][] = Array.from({ length: r.length + 1 }, (_, i) => Array.from({ length: h.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= r.length; i++) {
    for (let j = 1; j <= h.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (r[i - 1] === h[j - 1] ? 0 : 1));
  }
  const out = { refWords: r.length, sub: 0, del: 0, ins: 0 };
  for (let i = r.length, j = h.length; i > 0 || j > 0; ) {
    if (i > 0 && j > 0 && d[i]![j] === d[i - 1]![j - 1]! + (r[i - 1] === h[j - 1] ? 0 : 1)) {
      if (r[i - 1] !== h[j - 1]) out.sub++;
      i--; j--;
    } else if (i > 0 && d[i]![j] === d[i - 1]![j]! + 1) { out.del++; i--; }
    else { out.ins++; j--; }
  }
  return out;
}
