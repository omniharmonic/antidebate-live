// Live capture frames → utterances. One EnergyVad per setup channel; each utterance carries every
// channel's level over its span (the attributor's channel margin), an overlap flag, and when it
// ended on the wall clock (the runner's latency). Pure: no browser APIs, time comes in with frames.
import { EnergyVad, rmsDb, type Utterance } from './vad';

export type Segmented = { channel: string; u: Utterance; rms: Record<string, number>; overlap: boolean; endedAtWallMs: number };

export type SegmenterOptions = {
  /** Setup channel ids; frames on any other channel are ignored. */
  channels: string[];
  /** Session media time at tap start (frames' atMs count from 0 at tap start). */
  offsetMs: number;
  /** Epoch ms at tap start. */
  wallStartMs: number;
  onUtterance(x: Segmented): void;
};

const FRAME_MS = 20;
/** Levels kept per channel: the longest utterance (15 s) plus hangover, with room. */
const KEEP_FRAMES = 1_000;
/** Another channel's utterance counts as overlapping speech when it shares this much time... */
const OVERLAP_MIN_MS = 300;
/** ...and is no more than this far below the utterance's own channel over that time (else it is bleed). */
const BLEED_DB = 6;
const ACTIVE_MS = 1_500;

export class Segmenter {
  private readonly vads = new Map<string, EnergyVad>();
  /** Per channel: frame energy (mean square) by session ms, oldest first. */
  private readonly levels = new Map<string, { atMs: number; power: number }[]>();
  private readonly spans = new Map<string, { startMs: number; endMs: number }[]>();
  private readonly lastEnd = new Map<string, number>();

  constructor(private readonly o: SegmenterOptions) {
    for (const c of o.channels) {
      this.vads.set(c, new EnergyVad());
      this.levels.set(c, []);
      this.spans.set(c, []);
    }
  }

  push(channel: string, frame: Float32Array, atMs: number): void {
    const vad = this.vads.get(channel);
    if (!vad) return;
    const at = this.o.offsetMs + atMs;
    const lv = this.levels.get(channel)!;
    lv.push({ atMs: at, power: 10 ** (rmsDb(frame) / 10) });
    if (lv.length > KEEP_FRAMES) lv.shift();
    const u = vad.push(frame, at);
    if (!u) return;
    const overlap = this.overlaps(channel, u);
    const spans = this.spans.get(channel)!;
    spans.push({ startMs: u.startMs, endMs: u.endMs });
    if (spans.length > 20) spans.shift();
    this.lastEnd.set(channel, u.endMs);
    const rms = Object.fromEntries(this.o.channels.map((c) => [c, this.levelOver(c, u.startMs, u.endMs)]));
    this.o.onUtterance({ channel, u, rms, overlap, endedAtWallMs: this.o.wallStartMs + (u.endMs - this.o.offsetMs) });
  }

  /** Channels that finished an utterance within the last 1.5 s of session time (for Attributor.tick). */
  active(nowMs: number): Record<string, boolean> {
    return Object.fromEntries(this.o.channels.map((c) => [c, (this.lastEnd.get(c) ?? -Infinity) >= nowMs - ACTIVE_MS]));
  }

  private levelOver(channel: string, startMs: number, endMs: number): number {
    let sum = 0;
    let n = 0;
    for (const f of this.levels.get(channel) ?? []) {
      if (f.atMs >= startMs && f.atMs + FRAME_MS <= endMs) { sum += f.power; n += 1; }
    }
    return 10 * Math.log10(Math.max(n ? sum / n : 0, 1e-10));
  }

  /**
   * Only utterances already cut on the other channels are seen, so the first of two overlapping
   * speakers to stop is not marked; the flag only lowers confidence a little.
   */
  private overlaps(channel: string, u: Utterance): boolean {
    for (const c of this.o.channels) {
      if (c === channel) continue;
      for (const s of this.spans.get(c)!) {
        const from = Math.max(s.startMs, u.startMs);
        const to = Math.min(s.endMs, u.endMs);
        if (to - from < OVERLAP_MIN_MS) continue;
        if (this.levelOver(c, from, to) > this.levelOver(channel, from, to) - BLEED_DB) return true;
      }
    }
    return false;
  }
}
