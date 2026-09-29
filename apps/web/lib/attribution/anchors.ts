import { rmsDb } from '../live/vad';
import type { SpeakerSegment } from '../diarize/client';

// Enrollment anchors: short clips of each person's speech, diarized together with a live
// utterance to see whose voice the utterance shares. 16 kHz mono throughout.

const RATE = 16_000;
const FRAME = RATE / 50; // 20 ms
const GAP_MS = 500;
export const UTT_KEY = '__utt__' as const;
export const MIN_ENROLL_SECONDS = 10;

export type Anchor = { key: string; pcm: Float32Array };
export type Span = { key: string; startMs: number; endMs: number };

export function buildMatchInput(anchors: Anchor[], utterance: Float32Array): { samples: Float32Array; spans: Span[] } {
  const gap = (RATE * GAP_MS) / 1000;
  const total = anchors.reduce((n, a) => n + a.pcm.length + gap, 0) + utterance.length;
  const samples = new Float32Array(total);
  const spans: Span[] = [];
  const ms = (n: number) => Math.round((n * 1000) / RATE);
  let at = 0;
  for (const a of anchors) {
    samples.set(a.pcm, at);
    spans.push({ key: a.key, startMs: ms(at), endMs: ms(at + a.pcm.length) });
    at += a.pcm.length + gap;
  }
  samples.set(utterance, at);
  spans.push({ key: UTT_KEY, startMs: ms(at), endMs: ms(at + utterance.length) });
  return { samples, spans };
}

const overlap = (s: SpeakerSegment, span: Span) => Math.max(0, Math.min(s.endMs, span.endMs) - Math.max(s.startMs, span.startMs));

function timeByLabel(segments: SpeakerSegment[], span: Span): Map<string, number> {
  const t = new Map<string, number>();
  for (const s of segments) {
    const o = overlap(s, span);
    if (o > 0) t.set(s.label, (t.get(s.label) ?? 0) + o);
  }
  return t;
}

export function scoreFromSegments(segments: SpeakerSegment[], spans: Span[]): Record<string, number> {
  const utt = spans.find((s) => s.key === UTT_KEY);
  const anchors = spans.filter((s) => s.key !== UTT_KEY);
  const labelOf = new Map<string, string | undefined>();
  for (const a of anchors) {
    let best: string | undefined;
    let bestT = 0;
    for (const [label, t] of timeByLabel(segments, a)) if (t > bestT) { best = label; bestT = t; }
    labelOf.set(a.key, best);
  }
  const uttTimes = utt ? timeByLabel(segments, utt) : new Map<string, number>();
  const uttTotal = [...uttTimes.values()].reduce((n, t) => n + t, 0);
  const out: Record<string, number> = {};
  for (const a of anchors) {
    const label = labelOf.get(a.key);
    const shared = label !== undefined && anchors.some((b) => b.key !== a.key && labelOf.get(b.key) === label);
    out[a.key] = label === undefined || shared || uttTotal === 0 ? 0 : (uttTimes.get(label) ?? 0) / uttTotal;
  }
  return out;
}

const MARGIN_DB = 10; // EnergyVad's default margin
const BRIDGE_FRAMES = 10; // dips shorter than 200 ms inside speech stay in it

/**
 * Speech frames in time order. Same rule as EnergyVad (a frame more than 10 dB above the noise
 * floor) but the floor is the 10th percentile of the whole clip: EnergyVad's 5 s sliding floor
 * adapts to sustained speech and would drop the tail of a long, steady monologue.
 */
function speechFrames(pcm: Float32Array): Float32Array[] {
  const n = Math.floor(pcm.length / FRAME);
  const frames = Array.from({ length: n }, (_, i) => pcm.subarray(i * FRAME, (i + 1) * FRAME));
  if (n === 0) return [];
  const db = frames.map(rmsDb);
  const sorted = [...db].sort((a, b) => a - b);
  const floor = sorted[Math.floor((n - 1) * 0.1)]!;
  const isSpeech = db.map((d) => d > floor + MARGIN_DB);
  let last = -1;
  for (let i = 0; i < n; i++) {
    if (!isSpeech[i]) continue;
    if (last >= 0 && i - last - 1 <= BRIDGE_FRAMES) for (let j = last + 1; j < i; j++) isSpeech[j] = true;
    last = i;
  }
  return frames.filter((_, i) => isSpeech[i]);
}

export function speechSeconds(pcm: Float32Array): number {
  return (speechFrames(pcm).length * 20) / 1000;
}

/**
 * The most energetic contiguous stretch of speech, at most maxMs, with pauses removed. Whole
 * stretches rather than the loudest scattered frames: chopped audio degrades the voice embedding.
 */
export function trimAnchor(pcm: Float32Array, maxMs = 8_000): Float32Array {
  const frames = speechFrames(pcm);
  const want = Math.round(maxMs / 20);
  const use = (from: number, to: number) => {
    const out = new Float32Array((to - from) * FRAME);
    for (let i = from; i < to; i++) out.set(frames[i]!, (i - from) * FRAME);
    return out;
  };
  if (frames.length <= want) return use(0, frames.length);
  const energy = frames.map((f) => 10 ** (rmsDb(f) / 10));
  let sum = energy.slice(0, want).reduce((a, b) => a + b, 0);
  let best = sum;
  let bestAt = 0;
  for (let i = want; i < frames.length; i++) {
    sum += energy[i]! - energy[i - want]!;
    if (sum > best) { best = sum; bestAt = i - want + 1; }
  }
  return use(bestAt, bestAt + want);
}

export function enrollmentError(name: string, pcm: Float32Array): string | null {
  return speechSeconds(pcm) >= MIN_ENROLL_SECONDS ? null : `We heard less than ${MIN_ENROLL_SECONDS} seconds of speech from ${name}. Record again.`;
}
