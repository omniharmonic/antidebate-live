// The events the live runner writes for one line and for a host confirmation.
import type { DomainEvent } from '@adl/core';
import type { EventLog } from '@adl/engine';
import type { Word } from '../asr/chunks';
import type { Decision } from '../attribution/attributor';

/** A held line gets attribution.pending first, so no reader ever sees it as settled. */
export function lineEvents(o: { sessionId: string; id: string; u: { startMs: number; endMs: number }; words: Word[]; decision: Decision; wallTs: string }): {
  events: DomainEvent[];
  text: string;
  candidates: Record<string, number>;
} {
  const { sessionId, id, u, words, decision, wallTs } = o;
  const text = words.map((w) => w.text).join(' ').replace(/\s+([.,!?;:])/g, '$1');
  const events: DomainEvent[] = [];
  let candidates: Record<string, number> = {};
  if (decision.pending) {
    candidates = decision.candidates ?? (decision.candidate !== undefined ? { [decision.candidate]: decision.confidence } : {});
    events.push({ eventId: `${sessionId}:${id}:pending`, sessionId, type: 'attribution.pending', actor: 'system', mediaMs: u.endMs, wallTs, payload: { utteranceId: id, candidates } } as DomainEvent);
  }
  events.push({
    eventId: `${sessionId}:${id}`,
    sessionId,
    type: 'utterance.final',
    actor: 'system',
    mediaMs: u.endMs,
    wallTs,
    payload: {
      utterance: {
        id,
        participantKey: decision.participantKey,
        startMs: u.startMs,
        endMs: u.endMs,
        text,
        words: words.map((w) => ({ text: w.text, startMs: w.startMs, endMs: w.endMs, ...(w.confidence !== undefined ? { confidence: w.confidence } : {}) })),
        attribution: { confidence: decision.confidence, signals: decision.signals, confirmedBy: 'auto' as const },
        overlapsWith: [],
      },
    },
  } as DomainEvent);
  return { events, text, candidates };
}

export function confirmedEvent(o: { eventId: string; sessionId: string; utteranceId: string; participantKey: string; mediaMs: number; wallTs: string }): DomainEvent {
  return {
    eventId: o.eventId,
    sessionId: o.sessionId,
    type: 'attribution.confirmed',
    actor: 'operator',
    mediaMs: o.mediaMs,
    wallTs: o.wallTs,
    payload: { utteranceId: o.utteranceId, participantKey: o.participantKey },
  } as DomainEvent;
}

/** A line's end from the log (a line held before a reload is not in the runner's memory). */
export async function loggedEndMs(log: EventLog, utteranceId: string): Promise<number | undefined> {
  try {
    const { events } = await log.read(0);
    const e = events.find((x) => x.type === 'utterance.final' && x.payload.utterance.id === utteranceId);
    return e?.type === 'utterance.final' ? e.payload.utterance.endMs : undefined;
  } catch {
    return undefined;
  }
}
