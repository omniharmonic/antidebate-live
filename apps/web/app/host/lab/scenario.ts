// Pure helpers for the attribution lab (dev only): scenario audio, enrollment clips, the host's
// naming of separated voices, stub words, and the lines read back from the event log.
import type { DomainEvent } from '@adl/core';
import type { Word } from '@/lib/asr/chunks';
import { EnergyVad } from '@/lib/live/vad';
import type { Voice } from '@/lib/recording/voices';

const RATE = 16_000;
const FRAME = 320;

/** [startMs, endMs, participant key or 'UNK'], relative to the scenario cut. */
export type RefTurn = [number, number, string];
export type Reference = { turns: RefTurn[]; participants: { key: string; displayName: string; role: string }[] };
/**
 * One line as the shipping code logged it. Held lines add their best `candidate`; lines whose
 * confidence a setup cap bound (VOICE_ONLY_CAP) add `uncapped`, what they would score without it,
 * so the gate can measure the decisions the cap is holding back.
 */
export type LabLine = { startMs: number; endMs: number; participantKey: string; confidence: number; pending: boolean; candidate?: string; uncapped?: number };

/** 16 kHz mono WAV, 32-bit float or 16-bit PCM (what the scenario generator writes). */
export function parseWav(buf: ArrayBuffer): Float32Array {
  const v = new DataView(buf);
  const id = (at: number) => String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3));
  if (id(0) !== 'RIFF' || id(8) !== 'WAVE') throw new Error('not a WAV file');
  let fmt: { tag: number; channels: number; rate: number; bits: number } | null = null;
  for (let p = 12; p + 8 <= buf.byteLength; ) {
    const len = v.getUint32(p + 4, true);
    if (id(p) === 'fmt ') fmt = { tag: v.getUint16(p + 8, true), channels: v.getUint16(p + 10, true), rate: v.getUint32(p + 12, true), bits: v.getUint16(p + 22, true) };
    if (id(p) === 'data') {
      if (!fmt || fmt.channels !== 1 || fmt.rate !== RATE) throw new Error(`expected 16 kHz mono: ${JSON.stringify(fmt)}`);
      const n = Math.min(len, buf.byteLength - p - 8);
      if (fmt.tag === 3 && fmt.bits === 32) return new Float32Array(buf.slice(p + 8, p + 8 + n - (n % 4)));
      if (fmt.tag === 1 && fmt.bits === 16) return Float32Array.from(new Int16Array(buf.slice(p + 8, p + 8 + n - (n % 2))), (s) => s / 32768);
      throw new Error(`unsupported WAV format: ${JSON.stringify(fmt)}`);
    }
    p += 8 + len + (len & 1);
  }
  throw new Error('WAV has no data chunk');
}

/**
 * The speaker's first reference turns from `fromMs` on, joined up to `maxMs`: what a sound check
 * would record of them. A `fromMs` past the scored window keeps enrollment off the scored audio.
 */
export function anchorClip(pcm: Float32Array, turns: RefTurn[], key: string, maxMs = 30_000, fromMs = 0): Float32Array {
  const parts: Float32Array[] = [];
  let left = Math.round((maxMs * RATE) / 1000);
  for (const [s, e, k] of turns) {
    if (k !== key || left <= 0 || e <= fromMs) continue;
    const from = Math.round((Math.max(s, fromMs) * RATE) / 1000);
    const to = Math.min(pcm.length, Math.round((e * RATE) / 1000), from + left);
    if (to <= from) continue;
    parts.push(pcm.subarray(from, to));
    left -= to - from;
  }
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((at, p) => (out.set(p, at), at + p.length), 0);
  return out;
}

/**
 * The host names each listed voice after hearing its longest stretches: here, the reference speaker
 * those stretches overlap most. Audience (UNK) or no overlap leaves the voice unnamed ("Someone else").
 */
export function nameVoices(voices: Voice[], turns: RefTurn[], keys: string[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const v of voices) {
    const time = new Map<string, number>();
    for (const s of v.longest) {
      for (const [ts, te, k] of turns) {
        const o = Math.min(s.endMs, te) - Math.max(s.startMs, ts);
        if (o > 0) time.set(k, (time.get(k) ?? 0) + o);
      }
    }
    const top = [...time].sort((a, b) => b[1] - a[1])[0];
    out[v.label] = top && keys.includes(top[0]) ? top[0] : null;
  }
  return out;
}

const WORD_MS = 300;
const HANGOVER_MS = 200;
const MAX_MS = 15_000;
const MIN_WORD_MS = 100;

/**
 * Stub ASR words for a whole recording: ~300 ms words laid over the stretches the shipping energy
 * VAD hears as speech (a short 200 ms hangover so pauses stay pauses, no pre-roll), none over silence.
 * Real ASR words fall the same way: on speech, a few per second, with gaps at pauses.
 */
export function speechWords(pcm: Float32Array): Word[] {
  const vad = new EnergyVad({ hangoverMs: HANGOVER_MS, minSpeechMs: MIN_WORD_MS, maxUtteranceMs: MAX_MS, preRollMs: 0 });
  const words: Word[] = [];
  const n = Math.floor(pcm.length / FRAME);
  for (let i = 0; i < n; i++) {
    const u = vad.push(pcm.subarray(i * FRAME, (i + 1) * FRAME), i * 20);
    if (!u) continue;
    // Closed by silence: its last HANGOVER_MS are that silence. Closed at the length cap: all speech.
    const end = u.endMs - u.startMs >= MAX_MS ? u.endMs : u.endMs - HANGOVER_MS;
    for (let s = u.startMs; end - s >= MIN_WORD_MS; s += WORD_MS) words.push({ text: 'x', startMs: s, endMs: Math.min(s + WORD_MS, end) });
  }
  return words;
}

/** Each utterance.final as a lab line; held when an attribution.pending came with it. */
export function linesFromEvents(events: DomainEvent[], uncap?: (confidence: number, voiceprint: Record<string, number> | undefined) => number | undefined): LabLine[] {
  const held = new Map(events.flatMap((e) => (e.type === 'attribution.pending' ? [[e.payload.utteranceId, e.payload.candidates] as const] : [])));
  return events.flatMap((e) => {
    if (e.type !== 'utterance.final') return [];
    const u = e.payload.utterance;
    const line: LabLine = { startMs: u.startMs, endMs: u.endMs, participantKey: u.participantKey, confidence: u.attribution.confidence, pending: held.has(u.id) };
    const top = Object.entries(held.get(u.id) ?? {}).sort((a, b) => b[1] - a[1])[0];
    if (top) line.candidate = top[0];
    const raw = uncap?.(u.attribution.confidence, u.attribution.signals.voiceprint);
    if (raw !== undefined) line.uncapped = raw;
    return [line];
  });
}
