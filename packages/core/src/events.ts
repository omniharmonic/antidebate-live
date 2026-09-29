/**
 * The event log (ARCHITECTURE §4). Everything the system knows is an
 * append-only event. Projections, playback, audit and "as seen live" all
 * derive from this stream.
 */
import type {
  Adu,
  Proposition,
  Relation,
  Stance,
  Utterance,
} from '@adl/ontology';

export type Actor = 'system' | 'operator' | 'facilitator' | 'participant' | 'fixture';

export interface EventEnvelope<T extends string = string, P = unknown> {
  /** Idempotency key. */
  eventId: string;
  sessionId: string;
  type: T;
  actor: Actor;
  /** Position in the recording (content time). */
  mediaMs: number;
  /** When it happened in the room (ISO). Drives "as seen live". */
  wallTs: string;
  causedBy?: string[];
  payload: P;
}

export type ChannelId = 'stage' | 'livestream' | 'phones';
export type DialLevel = 0 | 1 | 2 | 3 | 4 | 5;
export type Module =
  | 'crux'
  | 'common_ground'
  | 'higher_ground'
  | 'questions'
  | 'credences'
  | 'drift'
  | 'transcript'
  | 'polls';

export type InsightKind = 'crux' | 'higher_ground' | 'drift' | 'prompt' | 'steelman' | 'update' | 'question' | 'shared';

export interface Insight {
  id: string;
  kind: InsightKind;
  /** Kind-specific body validated by @adl/ontology schemas at the producer. */
  body: Record<string, unknown>;
  refs: string[];
}

/**
 * `host`: created from the host flow (/host), written by the server. Host sessions stay off
 * the public list until the host publishes them, and only they accept host session tokens.
 */
/** `attribution: 'voice'`: speakers are told apart by voice alone (one mic in the room, or a call), spec §6.3. */
export type SessionSource = { kind: 'live' | 'recording'; fixture?: string; url?: string; speed?: number; host?: boolean; attribution?: 'voice' };

/** Discriminated union of every event the system writes. */
export type DomainEvent =
  | EventEnvelope<
      'session.started',
      {
        title: string;
        /** Format id (packages/core/src/formats.ts). */
        format: string;
        participants: { key: string; displayName: string; role: 'debater' | 'moderator' | 'audience' }[];
        /** participantKey → seat in the format (aff / neg / moderator). */
        seats?: Record<string, 'aff' | 'neg' | 'moderator' | 'audience'>;
        /** Where utterances come from: a live room, or a recording replayed through the live path. */
        source?: SessionSource;
      }
    >
  | EventEnvelope<'session.ended', Record<string, never>>
  /** A host session's place on the public list (host sessions start unlisted). The latest one wins. */
  | EventEnvelope<'session.published', { published: boolean }>
  | EventEnvelope<'round.started', { roundId: string; name: string; plannedMs?: number }>
  | EventEnvelope<'round.ended', { roundId: string }>
  | EventEnvelope<'utterance.partial', { utteranceId: string; participantKey: string; text: string }>
  | EventEnvelope<'utterance.final', { utterance: Utterance }>
  | EventEnvelope<'attribution.pending', { utteranceId: string; candidates: Record<string, number> }>
  | EventEnvelope<'attribution.confirmed', { utteranceId: string; participantKey: string }>
  | EventEnvelope<'turn.closed', { turnId: string; participantKey: string; utteranceIds: string[] }>
  | EventEnvelope<'adu.proposed', { adu: Adu }>
  | EventEnvelope<'proposition.proposed', { proposition: Proposition; sameAs?: string }>
  | EventEnvelope<'stance.proposed', { stance: Stance }>
  | EventEnvelope<'relation.proposed', { relation: Relation }>
  | EventEnvelope<'validation.result', { itemId: string; issues: { code: string; message: string }[] }>
  | EventEnvelope<'critic.verdict', { itemId: string; verdict: 'pass' | 'repair' | 'reject'; reason: string; repaired?: string }>
  | EventEnvelope<'insight.proposed', { insight: Insight }>
  | EventEnvelope<'item.approved', { itemId: string; note?: string }>
  | EventEnvelope<'item.edited', { itemId: string; patch: Record<string, unknown>; reason: string }>
  | EventEnvelope<'item.rejected', { itemId: string; reason: string }>
  /**
   * Identity resolution (L3). `fromId`'s stances and relations now point at `intoId`.
   * With `negated`, `fromId` states the negation of `intoId`: the linker emits flipped
   * stances on `intoId` first, and the old stances are retired rather than re-pointed.
   */
  | EventEnvelope<'item.merged', { fromId: string; intoId: string; negated?: boolean }>
  | EventEnvelope<'item.sent_to_facilitator', { itemId: string }>
  | EventEnvelope<'dial.set', { channel: ChannelId; level: DialLevel; toggles?: Partial<Record<Module, boolean>>; mode?: 'live' | 'reveal' }>
  | EventEnvelope<'release.published', { itemIds: string[]; channels: ChannelId[] }>
  | EventEnvelope<'release.retracted', { itemId: string }>
  | EventEnvelope<'blackout.set', { on: boolean }>
  | EventEnvelope<'spotlight.set', { itemId: string | null; channel: ChannelId }>;

export type EventType = DomainEvent['type'];
export type EventOf<T extends EventType> = Extract<DomainEvent, { type: T }>;
