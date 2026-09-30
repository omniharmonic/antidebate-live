// Energy VAD over 16 kHz mono frames. No browser APIs. The noise floor is the 10th percentile of
// the last 5 s of frame dB; speech is a frame more than marginDb above it.

export function rmsDb(pcm: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i]! * pcm[i]!;
  const rms = Math.sqrt(sum / Math.max(1, pcm.length));
  return 20 * Math.log10(Math.max(rms, 1e-5));
}

export interface VadOptions {
  frameMs?: number;
  hangoverMs?: number;
  minSpeechMs?: number;
  maxUtteranceMs?: number;
  marginDb?: number;
  /** Audio kept from before the first speech frame, so a soft onset is not clipped. */
  preRollMs?: number;
}

export interface Utterance {
  startMs: number;
  endMs: number;
  pcm: Float32Array;
}

const FLOOR_WINDOW_MS = 5000;

export class EnergyVad {
  private readonly frameMs: number;
  private readonly hangoverMs: number;
  private readonly minSpeechMs: number;
  private readonly maxUtteranceMs: number;
  private readonly marginDb: number;
  private readonly preRollFrames: number;
  private readonly history: number[] = [];
  /** Frames since the last utterance closed (at most the pre-roll): never part of a previous utterance. */
  private recent: Float32Array[] = [];
  private frames: Float32Array[] = [];
  private startMs = 0;
  private speechMs = 0;
  private silenceMs = 0;
  private open = false;
  private endMs = 0;

  constructor(opts: VadOptions = {}) {
    this.frameMs = opts.frameMs ?? 20;
    this.hangoverMs = opts.hangoverMs ?? 700;
    this.minSpeechMs = opts.minSpeechMs ?? 400;
    this.maxUtteranceMs = opts.maxUtteranceMs ?? 15_000;
    this.marginDb = opts.marginDb ?? 10;
    this.preRollFrames = Math.round((opts.preRollMs ?? 200) / this.frameMs);
  }

  push(frame: Float32Array, atMs: number): Utterance | null {
    const db = rmsDb(frame);
    this.history.push(db);
    if (this.history.length > Math.round(FLOOR_WINDOW_MS / this.frameMs)) this.history.shift();
    const sorted = [...this.history].sort((a, b) => a - b);
    const floor = sorted[Math.floor((sorted.length - 1) * 0.1)]!;
    const speech = db > floor + this.marginDb;

    if (!this.open) {
      if (!speech) {
        this.recent.push(frame);
        if (this.recent.length > this.preRollFrames) this.recent.shift();
        return null;
      }
      this.open = true;
      this.startMs = atMs - this.recent.length * this.frameMs;
      this.speechMs = 0;
      this.silenceMs = 0;
      this.frames = this.recent;
      this.recent = [];
    }
    this.frames.push(frame);
    if (speech) {
      this.speechMs += this.frameMs;
      this.silenceMs = 0;
    } else {
      this.silenceMs += this.frameMs;
    }

    const endMs = atMs + this.frameMs;
    this.endMs = endMs;
    if (this.silenceMs >= this.hangoverMs) return this.close(endMs);
    if (endMs - this.startMs >= this.maxUtteranceMs) {
      return this.close(endMs);
    }
    return null;
  }

  /** Finish only captured speech on pause/end/disconnect; never pad with invented silence. */
  flush(): Utterance | null {
    return this.open ? this.close(this.endMs) : null;
  }

  private close(endMs: number): Utterance | null {
    const keep = this.speechMs >= this.minSpeechMs;
    const frames = this.frames;
    this.open = false;
    this.frames = [];
    this.recent = [];
    if (!keep) return null;
    const pcm = new Float32Array(frames.length * (frames[0]?.length ?? 0));
    frames.forEach((f, i) => pcm.set(f, i * f.length));
    return { startMs: this.startMs, endMs, pcm };
  }
}
