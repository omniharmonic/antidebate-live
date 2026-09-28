/**
 * Convert recorded transcripts into the same `utterance.final` events the live
 * capture service emits, so replays exercise the real pipeline (IMPLEMENTATION_PLAN §1).
 */
import type { Utterance } from '@adl/ontology';
import type { DomainEvent } from './events';

/** Dialectical Topology `transcript_diarized.json` segment. */
export interface DtSegment {
  speaker: string;
  speaker_raw?: string;
  start_time: number;
  end_time?: number;
  text: string;
}

/** Offline transcription output from services/capture (`transcript.utterances.json`). */
export interface OfflineUtterance {
  speaker: string;
  startMs: number;
  endMs: number;
  text: string;
  words?: { text: string; startMs: number; endMs: number; confidence?: number }[];
  confidence?: number;
}

export interface FixtureParticipant {
  key: string;
  displayName: string;
  role: 'debater' | 'moderator' | 'audience';
  /** Speaker labels in the source transcript that map to this participant. */
  sourceLabels: string[];
}

/** Deterministic ids and wall clock, so replays are reproducible. */
function wallAt(baseIso: string, ms: number): string {
  return new Date(Date.parse(baseIso) + ms).toISOString();
}

export function utterancesToEvents(args: {
  sessionId: string;
  title: string;
  format: string;
  participants: FixtureParticipant[];
  utterances: OfflineUtterance[];
  baseWallIso?: string;
  confirmedBy?: Utterance['attribution']['confirmedBy'];
}): DomainEvent[] {
  const base = args.baseWallIso ?? '2026-01-01T00:00:00.000Z';
  const labelToKey = new Map<string, string>();
  for (const p of args.participants) for (const l of p.sourceLabels) labelToKey.set(l, p.key);

  const events: DomainEvent[] = [
    {
      eventId: `${args.sessionId}:start`,
      sessionId: args.sessionId,
      type: 'session.started',
      actor: 'fixture',
      mediaMs: 0,
      wallTs: wallAt(base, 0),
      payload: {
        title: args.title,
        format: args.format,
        participants: args.participants.map(({ key, displayName, role }) => ({ key, displayName, role })),
      },
    },
  ];
  args.utterances.forEach((u, i) => {
    const key = labelToKey.get(u.speaker) ?? 'UNK';
    const id = `${args.sessionId}:u${String(i).padStart(5, '0')}`;
    const utterance: Utterance = {
      id,
      participantKey: key,
      startMs: Math.round(u.startMs),
      endMs: Math.round(u.endMs),
      text: u.text.trim(),
      words: u.words ?? [],
      attribution: {
        confidence: key === 'UNK' ? 0 : (u.confidence ?? 1),
        signals: { diarLabel: u.speaker },
        confirmedBy: args.confirmedBy ?? 'fixture',
      },
      overlapsWith: [],
    };
    events.push({
      eventId: `${id}:final`,
      sessionId: args.sessionId,
      type: 'utterance.final',
      actor: 'fixture',
      mediaMs: utterance.endMs,
      wallTs: wallAt(base, utterance.endMs),
      payload: { utterance },
    });
  });
  return events;
}

export function dtSegmentsToUtterances(segments: DtSegment[]): OfflineUtterance[] {
  return segments.map((s, i) => {
    const next = segments[i + 1];
    const end = s.end_time ?? next?.start_time ?? s.start_time + 5;
    return { speaker: s.speaker, startMs: s.start_time * 1000, endMs: Math.max(end, s.start_time + 1) * 1000, text: s.text };
  });
}

export const DT_PARTICIPANTS: FixtureParticipant[] = [
  { key: 'A', displayName: 'Aubrey Marcus', role: 'debater', sourceLabels: ['marcus'] },
  { key: 'B', displayName: 'John Demartini', role: 'debater', sourceLabels: ['demartini'] },
];
