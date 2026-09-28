/**
 * L0 turn buffer (ARCHITECTURE §3.1). A turn closes when the speaker changes,
 * on a pause over 1.2 s after at least 8 words, or at a 25 s window during a
 * monologue. Pure: feed utterances in order and collect closed turns.
 */
import type { Utterance } from '@adl/ontology';

export interface Turn {
  turnId: string;
  participantKey: string;
  utterances: Utterance[];
  startMs: number;
  endMs: number;
  text: string;
}

export interface TurnBufferOptions {
  pauseMs: number;
  minWordsForPause: number;
  windowMs: number;
}

export const DEFAULT_TURN_OPTIONS: TurnBufferOptions = { pauseMs: 1200, minWordsForPause: 8, windowMs: 25_000 };

const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

export class TurnBuffer {
  private open: Utterance[] = [];
  private seq = 0;
  constructor(
    private readonly sessionId: string,
    private readonly opts: TurnBufferOptions = DEFAULT_TURN_OPTIONS,
  ) {}

  /** Add an utterance; returns any turns closed by it (0 or 1). */
  push(u: Utterance): Turn[] {
    const closed: Turn[] = [];
    const last = this.open.at(-1);
    if (last) {
      const speakerChanged = last.participantKey !== u.participantKey;
      const gap = u.startMs - last.endMs;
      const openWords = this.open.reduce((n, x) => n + words(x.text), 0);
      const pause = gap > this.opts.pauseMs && openWords >= this.opts.minWordsForPause;
      const window = u.endMs - this.open[0]!.startMs > this.opts.windowMs;
      if (speakerChanged || pause || window) {
        const t = this.flush();
        if (t) closed.push(t);
      }
    }
    this.open.push(u);
    return closed;
  }

  /** Close whatever is open (end of session or round). */
  flush(): Turn | null {
    if (this.open.length === 0) return null;
    const us = this.open;
    this.open = [];
    return {
      turnId: `${this.sessionId}:t${String(this.seq++).padStart(4, '0')}`,
      participantKey: us[0]!.participantKey,
      utterances: us,
      startMs: us[0]!.startMs,
      endMs: us.at(-1)!.endMs,
      text: us.map((x) => x.text).join(' '),
    };
  }
}
