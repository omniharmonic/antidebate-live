/**
 * Words + speaker segments → utterance events (spec §5, recordings). A guess never
 * becomes a debater's claim: unnamed voices, boundary words and uncovered speech are
 * emitted as UNK or held with attribution.pending (below the 0.85 auto threshold).
 * Event ids derive from media times, so re-running a chunk after a reload is idempotent.
 * A held utterance's attribution.pending is emitted before its utterance.final so a
 * consumer reading pending state at ingest of the final already sees it.
 */
import type { DomainEvent } from '@adl/core';
import type { SpeakerSegment } from '@/lib/diarize/client';
import type { Word } from '@/lib/asr/chunks';

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

function segmentAt(segs: SpeakerSegment[], ms: number): SpeakerSegment | undefined {
  return segs.find((s) => ms >= s.startMs && ms < s.endMs);
}

function nearChange(segs: SpeakerSegment[], startMs: number, endMs: number, label: string): boolean {
  return segs.some((s) => s.label !== label && (Math.abs(s.startMs - startMs) < BOUNDARY_MS || Math.abs(s.endMs - startMs) < BOUNDARY_MS || Math.abs(s.startMs - endMs) < BOUNDARY_MS));
}

/** Split each pause-delimited run again wherever the speaker label changes. */
function byLabel(run: Word[], segs: SpeakerSegment[]): { label: string | null; words: Word[] }[] {
  const out: { label: string | null; words: Word[] }[] = [];
  for (const w of run) {
    const label = segmentAt(segs, (w.startMs + w.endMs) / 2)?.label ?? null;
    const cur = out.at(-1);
    if (cur && cur.label === label) cur.words.push(w);
    else out.push({ label, words: [w] });
  }
  return out;
}

export function buildUtterances(o: { sessionId: string; words: Word[]; segments: SpeakerSegment[]; voiceMap: Record<string, string | null>; mode: 'diarized' | 'tracks'; wallTs: string; trackOwner?: string }): DomainEvent[] {
  const events: DomainEvent[] = [];
  for (const run of splitIntoUtterances(o.words)) {
    for (const part of o.mode === 'tracks' ? [{ label: null, words: run }] : byLabel(run, o.segments)) {
      const startMs = part.words[0]!.startMs;
      const endMs = part.words.at(-1)!.endMs;
      const id = `u${startMs}`;
      const text = part.words.map((w) => w.text).join(' ').replace(/\s+([.,!?;:])/g, '$1');
      let participantKey = 'UNK';
      let confidence = HOLD;
      let confirmedBy: 'auto' | 'operator' = 'auto';
      let signals: { channel?: string; diarLabel?: string } = {};
      if (o.mode === 'tracks' && o.trackOwner) {
        participantKey = o.trackOwner;
        confidence = 1;
        signals = { channel: o.trackOwner };
      } else if (part.label) {
        const seg = segmentAt(o.segments, (startMs + endMs) / 2)!;
        const named = o.voiceMap[part.label] ?? null;
        signals = { diarLabel: part.label };
        if (named) {
          participantKey = named;
          const edge = nearChange(o.segments, startMs, endMs, part.label);
          confidence = edge ? HOLD : Math.min(0.95, seg.confidence);
          confirmedBy = edge ? 'auto' : 'operator';
        }
      }
      if (confidence < 0.85) {
        const candidates: Record<string, number> = participantKey === 'UNK' ? {} : { [participantKey]: confidence };
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
