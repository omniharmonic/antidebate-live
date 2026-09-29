// Scoring for the attribution gate. All shares are of reference speech time, at 10 ms resolution.
// A reference bin counts once. Where reference speakers overlap, matching any of them is right.

export type Ref = [startMs: number, endMs: number, key: string];
export type Pred = { startMs: number; endMs: number; participantKey: string; confidence: number; pending: boolean };
export type Run = { reference: Ref[]; predicted: Pred[] };
export type Scores = { correct: number; wrongAuto: number; wrongHeld: number; held: number; missed: number };

const BIN = 10;
const CANDIDATES = [0.85, 0.88, 0.9, 0.92, 0.95, 0.97, 0.99];
export const MAX_WRONG_AUTO = 0.02;

type Counts = { total: number } & Scores;

function count(reference: Ref[], predicted: Pred[], threshold: number): Counts {
  const c: Counts = { total: 0, correct: 0, wrongAuto: 0, wrongHeld: 0, held: 0, missed: 0 };
  const end = Math.max(0, ...reference.map((r) => r[1]));
  const bins = Math.ceil(end / BIN);
  const refs: (Set<string> | undefined)[] = new Array(bins);
  for (const [s, e, k] of reference) for (let b = Math.floor(s / BIN); b < Math.ceil(e / BIN); b++) (refs[b] ??= new Set()).add(k);
  const pred: (Pred | undefined)[] = new Array(bins);
  for (const p of predicted) for (let b = Math.floor(p.startMs / BIN); b < Math.min(bins, Math.ceil(p.endMs / BIN)); b++) pred[b] ??= p;
  for (let b = 0; b < bins; b++) {
    const r = refs[b];
    if (!r) continue;
    c.total++;
    const p = pred[b];
    if (!p) { c.missed++; continue; }
    // Auto-accepted: not held by rule (pending), not below the threshold, and names a person.
    const auto = !p.pending && p.confidence >= threshold && p.participantKey !== 'UNK';
    if (auto) {
      if (r.has(p.participantKey)) c.correct++;
      else c.wrongAuto++;
    } else if (r.has('UNK')) c.correct++;
    else {
      c.held++;
      if (!r.has(p.participantKey)) c.wrongHeld++;
    }
  }
  return c;
}

const share = (c: Counts): Scores => {
  const t = c.total || 1;
  return { correct: c.correct / t, wrongAuto: c.wrongAuto / t, wrongHeld: c.wrongHeld / t, held: c.held / t, missed: c.missed / t };
};

/** `held` is every held reference-speech bin (right or wrong candidate); `wrongHeld` is the subset whose candidate was wrong. correct + wrongAuto + held + missed = 1. */
export function score(reference: Ref[], predicted: Pred[], threshold: number): Scores {
  return share(count(reference, predicted, threshold));
}

/** Scores pooled by speech time across runs. */
export function pooled(runs: Run[], threshold: number): Scores {
  const sum: Counts = { total: 0, correct: 0, wrongAuto: 0, wrongHeld: 0, held: 0, missed: 0 };
  for (const r of runs) {
    const c = count(r.reference, r.predicted, threshold);
    for (const k of Object.keys(sum) as (keyof Counts)[]) sum[k] += c[k];
  }
  return share(sum);
}

export type Calibration = { threshold: number; hostConfirmsAll: boolean; atThreshold: Scores };

export function calibrate(runs: Run[], candidates: number[] = CANDIDATES): Calibration {
  for (const threshold of [...candidates].sort((a, b) => a - b)) {
    const atThreshold = pooled(runs, threshold);
    if (atThreshold.wrongAuto <= MAX_WRONG_AUTO) return { threshold, hostConfirmsAll: false, atThreshold };
  }
  return { threshold: 0.99, hostConfirmsAll: true, atThreshold: pooled(runs, 0.99) };
}

/** A lab line: held lines add their best `candidate`; lines the voice-only cap bound add `uncapped`. */
export type LabPred = Pred & { candidate?: string; uncapped?: number };

/**
 * P3-R4: mono-live lines are scored as the gate would see them with only the voice-only cap lifted.
 * A line counts toward auto-accept only when the cap was its sole reason for pending (the lab marks
 * those with `uncapped`); lines pending for any other reason (no candidate, a low fused score, held
 * by rule) stay held at every threshold. Other setups are scored as recorded.
 */
export function gatePred(setup: string, u: LabPred): Pred {
  const { startMs, endMs, confidence, pending } = u;
  if (setup !== 'mono-live') return { startMs, endMs, participantKey: u.participantKey, confidence, pending };
  const participantKey = u.candidate ?? u.participantKey;
  if (u.uncapped !== undefined) return { startMs, endMs, participantKey, confidence: u.uncapped, pending: false };
  return { startMs, endMs, participantKey, confidence, pending };
}
