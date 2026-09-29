// Speech picked up by two mics at similar levels (within 6 dB) is cut on both channels. Only the
// louder channel's cut becomes a line; the quieter one is dropped before transcription, so one
// thing said is never logged twice. Pure: time comes in with the cuts and ticks.
// Overlap is measured against the longer cut: a true copy aligns with its original at both ends,
// while a short interjection inside someone's long line is speech of its own.

export type Cut = { channel: string; startMs: number; endMs: number; /** own level minus the loudest other channel, dB */ margin: number };

/** A quieter cut waits this long (session ms after it ends) for its louder copy before it runs anyway. */
export const COPY_WAIT_MS = 3_000;
const KEEP = 50;

/** More than half of the longer cut is shared (P2-R10). */
export function sameSpeech(a: Cut, b: Cut): boolean {
  const shared = Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs);
  const longer = Math.max(a.endMs - a.startMs, b.endMs - b.startMs);
  return a.channel !== b.channel && longer > 0 && shared > longer / 2;
}

export class CopyFilter<T extends Cut> {
  private kept: Cut[] = [];
  private held: T[] = [];

  /** `onCopy(kept, dropped)`: called for each dropped copy, before the kept cut is returned when it arrives second. */
  constructor(private readonly onCopy?: (kept: Cut, dropped: T) => void) {}

  /** The cuts to run now: this one, or none (a quieter copy, dropped or held for its louder copy). */
  offer(c: T): T[] {
    if (c.margin >= 0) {
      this.keep(c);
      const copies = this.held.filter((h) => sameSpeech(h, c));
      for (const h of copies) this.onCopy?.(c, h);
      this.held = this.held.filter((h) => !copies.includes(h));
      return [c];
    }
    const original = this.kept.find((k) => sameSpeech(k, c));
    if (original) {
      this.onCopy?.(original, c);
      return [];
    }
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
