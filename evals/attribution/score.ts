// Scoring for the attribution gate. All shares are of reference speech time, at 10 ms resolution.
// A reference bin counts once. Where reference speakers overlap, matching any of them is right.

export type Ref = [startMs: number, endMs: number, key: string];
export type Pred = { startMs: number; endMs: number; participantKey: string; confidence: number; pending: boolean };
/** `exclude`: spans not scored (the audio enrollment clips were cut from, so no clip is scored speech). */
export type Run = { reference: Ref[]; predicted: Pred[]; exclude?: [number, number][] };
/**
 * Shares of reference speech. `wrongAutoOfAuto` is the precision view: wrong auto-accepted speech as a
 * share of all auto-accepted speech (0 when nothing auto-accepts).
 */
export type Scores = { correct: number; wrongAuto: number; wrongHeld: number; held: number; missed: number; wrongAutoOfAuto: number };

const BIN = 10;
const CANDIDATES = [0.85, 0.88, 0.9, 0.92, 0.95, 0.97, 0.99];
export const MAX_WRONG_AUTO = 0.02;

type Counts = { total: number; correct: number; wrongAuto: number; wrongHeld: number; held: number; missed: number; autoCorrect: number };
const zero = (): Counts => ({ total: 0, correct: 0, wrongAuto: 0, wrongHeld: 0, held: 0, missed: 0, autoCorrect: 0 });

const inSpans = (ms: number, spans: [number, number][] | undefined) => (spans ?? []).some(([s, e]) => ms >= s && ms < e);

function count(reference: Ref[], predicted: Pred[], threshold: number, exclude?: [number, number][]): Counts {
  const c = zero();
  const end = Math.max(0, ...reference.map((r) => r[1]));
  const bins = Math.ceil(end / BIN);
  const refs: (Set<string> | undefined)[] = new Array(bins);
  for (const [s, e, k] of reference) for (let b = Math.floor(s / BIN); b < Math.ceil(e / BIN); b++) (refs[b] ??= new Set()).add(k);
  for (const [s, e] of exclude ?? []) for (let b = Math.floor(s / BIN); b < Math.min(bins, Math.ceil(e / BIN)); b++) refs[b] = undefined;
  const pred: (Pred | undefined)[] = new Array(bins);
  for (const p of predicted) for (let b = Math.floor(p.startMs / BIN); b < Math.min(bins, Math.ceil(p.endMs / BIN)); b++) pred[b] ??= p;
  for (let b = 0; b < bins; b++) {
    const r = refs[b];
    if (!r) continue;
    c.total++;
    const p = pred[b];
    if (!p) { c.missed++; continue; }
    // Auto-accepted: not held by rule (pending), not below the threshold, and names a person.
    const auto = isAuto(p, threshold);
    if (auto) {
      if (r.has(p.participantKey)) {
        c.correct++;
        c.autoCorrect++;
      } else c.wrongAuto++;
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
  const auto = c.autoCorrect + c.wrongAuto;
  return { correct: c.correct / t, wrongAuto: c.wrongAuto / t, wrongHeld: c.wrongHeld / t, held: c.held / t, missed: c.missed / t, wrongAutoOfAuto: auto ? c.wrongAuto / auto : 0 };
};

/**
 * `held` is every held reference-speech bin; `wrongHeld` is the subset whose best guess (the held
 * line's candidate, see gatePred) was wrong or missing. correct + wrongAuto + held + missed = 1.
 */
export function score(reference: Ref[], predicted: Pred[], threshold: number): Scores {
  return share(count(reference, predicted, threshold));
}

/** Scores pooled by speech time across runs. */
export function pooled(runs: Run[], threshold: number): Scores {
  const sum = zero();
  for (const r of runs) {
    const c = count(r.reference, r.predicted, threshold, r.exclude);
    for (const k of Object.keys(sum) as (keyof Counts)[]) sum[k] += c[k];
  }
  return share(sum);
}

/** `fixturesAtMin`: runs (one per fixture) with at least `min.fixtureLines` auto-accepted lines. */
export type Sample = { autoLines: number; autoSpeechMs: number; fixturesAtMin: number };
/**
 * P3-R7: a clean error bar on a small sample is not evidence. A setup passes only when the lines
 * auto-accepted at the chosen threshold, pooled, number at least 200 and span at least 20 minutes.
 * P3-R10: and the evidence is representative: at least 2 fixtures contribute 25 auto-accepted lines each.
 */
export const MIN_SAMPLE = { lines: 200, speechMs: 20 * 60_000, fixtures: 2, fixtureLines: 25 };
export type Calibration = { threshold: number; hostConfirmsAll: boolean; insufficient: boolean; atThreshold: Scores; sample: Sample };

const isAuto = (p: Pred, threshold: number) => !p.pending && p.confidence >= threshold && p.participantKey !== 'UNK';
const scored = (r: Run) => r.predicted.filter((p) => !inSpans((p.startMs + p.endMs) / 2, r.exclude));

/** The lines auto-accepted at `threshold` across the runs (outside excluded spans), and their speech time. */
export function sample(runs: Run[], threshold: number, min: Pick<typeof MIN_SAMPLE, 'fixtureLines'> = MIN_SAMPLE): Sample {
  const per = runs.map((r) => scored(r).filter((p) => isAuto(p, threshold)));
  const auto = per.flat();
  return { autoLines: auto.length, autoSpeechMs: auto.reduce((n, p) => n + (p.endMs - p.startMs), 0), fixturesAtMin: per.filter((a) => a.length >= min.fixtureLines).length };
}

/**
 * The lowest candidate threshold at which wrong auto-accepts are at most 2%, pooled and in every
 * fixture that auto-accepts anything (P3-R10: a clean pool cannot hide a bad fixture). If none is,
 * the host confirms all. The chosen threshold is `insufficient` (not passed) unless the sample is big
 * enough (P3-R7) and representative (P3-R10): see MIN_SAMPLE.
 */
export function calibrate(runs: Run[], candidates: number[] = CANDIDATES, min = MIN_SAMPLE): Calibration {
  for (const threshold of [...candidates].sort((a, b) => a - b)) {
    const atThreshold = pooled(runs, threshold);
    if (atThreshold.wrongAuto > MAX_WRONG_AUTO) continue;
    if (runs.some((r) => sample([r], threshold, min).autoLines > 0 && pooled([r], threshold).wrongAuto > MAX_WRONG_AUTO)) continue;
    const s = sample(runs, threshold, min);
    const insufficient = s.autoLines < min.lines || s.autoSpeechMs < min.speechMs || s.fixturesAtMin < min.fixtures;
    return { threshold, hostConfirmsAll: false, insufficient, atThreshold, sample: s };
  }
  return { threshold: 0.99, hostConfirmsAll: true, insufficient: false, atThreshold: pooled(runs, 0.99), sample: sample(runs, 0.99, min) };
}

/**
 * Lines logged twice: two predicted lines on different channels whose shared time is more than half
 * of the shorter one (the same speech kept from two mics). Lines centred in excluded spans are not counted.
 */
export function duplicates(lines: { startMs: number; endMs: number; channel?: string }[], exclude?: [number, number][]): number {
  const kept = lines.filter((l) => l.channel !== undefined && !inSpans((l.startMs + l.endMs) / 2, exclude)).sort((a, b) => a.startMs - b.startMs);
  let n = 0;
  for (let i = 0; i < kept.length; i++) {
    const a = kept[i]!;
    for (let j = i + 1; j < kept.length && kept[j]!.startMs < a.endMs; j++) {
      const b = kept[j]!;
      if (b.channel === a.channel) continue;
      const shared = Math.min(a.endMs, b.endMs) - b.startMs;
      if (shared > 0.5 * Math.min(a.endMs - a.startMs, b.endMs - b.startMs)) n++;
    }
  }
  return n;
}

/**
 * A lab line: held lines add their best `candidate`; lines the voice-only cap bound carry `capped: true`
 * (set by the lab from the attributor's decision) and `uncapped`, their score without the cap.
 * `channel`: the capture channel the line was cut from (live setups).
 */
export type LabPred = Pred & { candidate?: string; capped?: boolean; uncapped?: number; channel?: string };

/**
 * P3-R4: mono-live lines are scored as the gate would see them with only the voice-only cap lifted.
 * A line counts toward auto-accept only when the cap was its sole reason for pending (the lab flags
 * those `capped`); lines pending for any other reason (no candidate, a low fused score, held by rule)
 * stay held at every threshold. Other setups are scored as recorded: the tracks dead-mic cap is never
 * lifted (P3-R10). A held line is named by its best guess, so "held, guess wrong or missing" means that.
 */
export function gatePred(setup: string, u: LabPred): Pred {
  const { startMs, endMs, confidence, pending } = u;
  const participantKey = pending ? (u.candidate ?? u.participantKey) : u.participantKey;
  if (setup === 'mono-live' && u.capped && u.uncapped !== undefined) return { startMs, endMs, participantKey, confidence: u.uncapped, pending: false };
  return { startMs, endMs, participantKey, confidence, pending };
}

/** One gate.json entry, as apps/web/lib/attribution/gate.ts reads it. */
export type GateEntry = { threshold: number; hostConfirmsAll: boolean; insufficient?: true; measuredFrom?: 'room-mix' };
export type GateName = 'tracks' | 'call' | 'room' | 'recording';

/**
 * The gate.json entry for a setup. Room (and call) pass only on enrollment disjoint from the scored
 * audio (P3-R6). Call is measured from the room mix, not call audio, so it stays insufficient (P3-R10).
 */
export function gateEntry(name: GateName, c: Calibration, o: { disjointEnrollment: boolean }): GateEntry {
  const voiceOnly = name === 'call' || name === 'room';
  const insufficient = c.insufficient || (voiceOnly && !o.disjointEnrollment) || name === 'call';
  return { threshold: c.threshold, hostConfirmsAll: c.hostConfirmsAll, ...(insufficient ? { insufficient: true as const } : {}), ...(name === 'call' ? { measuredFrom: 'room-mix' as const } : {}) };
}

/** The strictest of several entries (P3-R11: tracks takes its worst realistic scenario). */
export function worstGate(entries: GateEntry[]): GateEntry {
  const confirms = entries.find((e) => e.hostConfirmsAll);
  if (confirms) return { threshold: confirms.threshold, hostConfirmsAll: true };
  const threshold = Math.max(...entries.map((e) => e.threshold));
  return { threshold, hostConfirmsAll: false, ...(entries.some((e) => e.insufficient) ? { insufficient: true as const } : {}) };
}
