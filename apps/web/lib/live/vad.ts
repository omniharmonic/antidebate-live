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
  private readonly history: number[] = [];
  private frames: Float32Array[] = [];
  private dbs: number[] = [];
  private startMs = 0;
  private speechMs = 0;
  private silenceMs = 0;
  private open = false;

  constructor(opts: VadOptions = {}) {
    this.frameMs = opts.frameMs ?? 20;
    this.hangoverMs = opts.hangoverMs ?? 700;
    this.minSpeechMs = opts.minSpeechMs ?? 400;
    this.maxUtteranceMs = opts.maxUtteranceMs ?? 15_000;
    this.marginDb = opts.marginDb ?? 10;
  }

  push(frame: Float32Array, atMs: number): Utterance | null {
    const db = rmsDb(frame);
    const cap = Math.round(FLOOR_WINDOW_MS / this.frameMs);
    const floorOf = (): number => {
      const sorted = [...this.history].sort((a, b) => a - b);
      return sorted[Math.floor((sorted.length - 1) * 0.1)]!;
    };
    if (!this.open) this.history.push(db);
    if (this.history.length > cap) this.history.shift();
    const floor = floorOf();
    // While an utterance is open, frames enter the history clamped to floor + margin: a long
    // monologue cannot drag the floor up, but a sustained noise rise can creep it up.
    if (this.open) {
      this.history.push(Math.min(db, floor + this.marginDb));
      if (this.history.length > cap) this.history.shift();
    }
    const speech = db > floor + this.marginDb;

    if (!this.open) {
      if (!speech) return null;
      this.open = true;
      this.startMs = atMs;
      this.speechMs = 0;
      this.silenceMs = 0;
      this.frames = [];
      this.dbs = [];
    }
    this.frames.push(frame);
    this.dbs.push(db);
    if (speech) {
      this.speechMs += this.frameMs;
      this.silenceMs = 0;
    } else {
      this.silenceMs += this.frameMs;
    }

    const endMs = atMs + this.frameMs;
    if (this.silenceMs >= this.hangoverMs) return this.close(endMs);
    if (endMs - this.startMs >= this.maxUtteranceMs) {
      // Seed the floor with the last ~2 s so a sustained noise rise is not reopened as speech.
      this.history.length = 0;
      this.history.push(...this.dbs.slice(-Math.round(2000 / this.frameMs)));
      return this.close(endMs);
    }
    return null;
  }

  private close(endMs: number): Utterance | null {
    const keep = this.speechMs >= this.minSpeechMs;
    const frames = this.frames;
    this.open = false;
    this.frames = [];
    if (!keep) return null;
    const pcm = new Float32Array(frames.length * (frames[0]?.length ?? 0));
    frames.forEach((f, i) => pcm.set(f, i * f.length));
    return { startMs: this.startMs, endMs, pcm };
  }
}
