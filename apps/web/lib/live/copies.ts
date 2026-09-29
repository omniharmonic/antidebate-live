// Speech picked up by two mics at similar levels (within 6 dB) is cut on both channels. Only the
// louder channel's cut becomes a line; the quieter one is dropped before transcription, so one
// thing said is never logged twice. Pure: time comes in with the cuts and ticks.

export type Cut = { channel: string; startMs: number; endMs: number; /** own level minus the loudest other channel, dB */ margin: number };

/** A quieter cut waits this long (session ms after it ends) for its louder copy before it runs anyway. */
export const COPY_WAIT_MS = 3_000;
const KEEP = 50;

/** More than half of the shorter cut is shared. */
export function sameSpeech(a: Cut, b: Cut): boolean {
  const shared = Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs);
  const shorter = Math.min(a.endMs - a.startMs, b.endMs - b.startMs);
  return a.channel !== b.channel && shorter > 0 && shared > shorter / 2;
}

export class CopyFilter<T extends Cut> {
  private kept: Cut[] = [];
  private held: T[] = [];

  /** The cuts to run now: this one, or none (a quieter copy, dropped or held for its louder copy). */
  offer(c: T): T[] {
    if (c.margin >= 0) {
      this.keep(c);
      this.held = this.held.filter((h) => !sameSpeech(h, c));
      return [c];
    }
    if (this.kept.some((k) => sameSpeech(k, c))) return [];
    this.held.push(c);
    return [];
  }

  /** Quieter cuts whose louder copy never came: they were speech of their own. */
  release(nowMs: number): T[] {
    const due = this.held.filter((h) => h.endMs + COPY_WAIT_MS <= nowMs);
    this.held = this.held.filter((h) => !due.includes(h));
    for (const d of due) this.keep(d);
    return due;
  }

  /** Everything still held (capture stopping). */
  flush(): T[] {
    return this.release(Infinity);
  }

  private keep(c: Cut) {
    this.kept.push({ channel: c.channel, startMs: c.startMs, endMs: c.endMs, margin: c.margin });
    if (this.kept.length > KEEP) this.kept.shift();
  }
}
