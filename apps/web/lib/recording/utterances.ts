/**
 * Words + speaker segments → utterance events (spec §5, recordings). A guess never
 * becomes a debater's claim: unnamed voices, boundary words and uncovered speech are
 * held as UNK with attribution.pending (below the measured recording threshold, never under 0.85); a held line's best
 * guess appears only among the pending candidates, never as its speaker. Named voices are
 * the diarizer's unmeasured output, so they are `confirmedBy: 'auto'`, not operator-confirmed.
 * Event ids derive from media times, so re-running a chunk after a reload is idempotent.
 * A held utterance's attribution.pending is emitted before its utterance.final so a
 * consumer reading pending state at ingest of the final already sees it.
 */
import type { DomainEvent } from '@adl/core';
import type { SpeakerSegment } from '@/lib/diarize/client';
import type { Word } from '@/lib/asr/chunks';
import { gateFor, type Gate } from '@/lib/attribution/gate';

const HOLD = 0.6;
const BOUNDARY_MS = 300;

export function splitIntoUtterances(words: Word[], gapMs = 800): Word[][] {
  const out: Word[][] = [];
  for (const w of words) {
    const cur = out.at(-1);
    if (cur && w.startMs - cur.at(-1)!.endMs < gapMs) cur.push(w);
    else out.push([w]);
  }
  return out;
}

type Part = { label: string | null; segs: SpeakerSegment[]; words: Word[] };

/**
 * Segments covering a word's midpoint. Exactly one distinct label gives that label;
 * none (a gap) or several labels (overlap) leave the word unattributed.
 */
function coverOf(segs: SpeakerSegment[], w: Word): { label: string | null; segs: SpeakerSegment[] } {
  const mid = (w.startMs + w.endMs) / 2;
  const hit = segs.filter((s) => mid >= s.startMs && mid < s.endMs);
  const labels = new Set(hit.map((s) => s.label));
  return labels.size === 1 ? { label: hit[0]!.label, segs: hit } : { label: null, segs: [] };
}

/** Another voice active within BOUNDARY_MS of the utterance: never auto-committed. */
function otherVoiceNear(segs: SpeakerSegment[], startMs: number, endMs: number, label: string): boolean {
  return segs.some((s) => s.label !== label && s.startMs < endMs + BOUNDARY_MS && s.endMs > startMs - BOUNDARY_MS);
}

/** Split each pause-delimited run again wherever the speaker label changes. */
function byLabel(run: Word[], segs: SpeakerSegment[]): Part[] {
  const out: Part[] = [];
  for (const w of run) {
    const c = coverOf(segs, w);
    const cur = out.at(-1);
    if (cur && cur.label === c.label) {
      cur.words.push(w);
      for (const s of c.segs) if (!cur.segs.includes(s)) cur.segs.push(s);
    } else out.push({ label: c.label, segs: [...c.segs], words: [w] });
  }
  return out;
}

export function buildUtterances(o: { sessionId: string; words: Word[]; segments: SpeakerSegment[]; voiceMap: Record<string, string | null>; mode: 'diarized' | 'tracks'; wallTs: string; trackOwner?: string; gate?: Gate }): DomainEvent[] {
  const events: DomainEvent[] = [];
  // The measured recording gate covers diarized voices; a track's owner (confidence 1) is never below it.
  const gate = o.gate ?? gateFor('recording');
  for (const run of splitIntoUtterances(o.words)) {
    for (const part of o.mode === 'tracks' ? [{ label: null, segs: [], words: run } as Part] : byLabel(run, o.segments)) {
      const startMs = part.words[0]!.startMs;
      const endMs = part.words.at(-1)!.endMs;
      const id = o.mode === 'tracks' && o.trackOwner ? `u${o.trackOwner}-${startMs}` : `u${startMs}`;
      const text = part.words.map((w) => w.text).join(' ').replace(/\s+([.,!?;:])/g, '$1');
      let guess = 'UNK';
      let confidence = HOLD;
      let signals: { channel?: string; diarLabel?: string } = {};
      if (o.mode === 'tracks' && o.trackOwner) {
        guess = o.trackOwner;
        confidence = 1;
        signals = { channel: o.trackOwner };
      } else if (part.label) {
        const named = o.voiceMap[part.label] ?? null;
        signals = { diarLabel: part.label };
        if (named) {
          guess = named;
          const edge = otherVoiceNear(o.segments, startMs, endMs, part.label);
          confidence = edge ? HOLD : Math.min(0.95, ...part.segs.map((x) => x.confidence));
        }
      }
      const held = confidence < gate.threshold || (gate.hostConfirmsAll && o.mode === 'diarized');
      const participantKey = held ? 'UNK' : guess;
      const confirmedBy = 'auto' as const;
      if (held) {
        const candidates: Record<string, number> = guess === 'UNK' ? {} : { [guess]: confidence };
        events.push({ eventId: `${o.sessionId}:${id}:pending`, sessionId: o.sessionId, type: 'attribution.pending', actor: 'system', mediaMs: endMs, wallTs: o.wallTs, payload: { utteranceId: id, candidates } } as DomainEvent);
      }
      events.push({
        eventId: `${o.sessionId}:${id}`,
        sessionId: o.sessionId,
        type: 'utterance.final',
        actor: 'system',
        mediaMs: endMs,
        wallTs: o.wallTs,
        payload: { utterance: { id, participantKey, startMs, endMs, text, words: part.words.map((w) => ({ text: w.text, startMs: w.startMs, endMs: w.endMs, ...(w.confidence !== undefined ? { confidence: w.confidence } : {}) })), attribution: { confidence, signals, confirmedBy }, overlapsWith: [] } },
      } as DomainEvent);
    }
  }
  return events;
}
