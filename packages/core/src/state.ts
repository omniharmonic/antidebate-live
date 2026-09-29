/** Projection state (ARCHITECTURE §4.2): the current view of a session. */
import type { Adu, Proposition, Relation, Stance, Utterance } from '@adl/ontology';
import type { ChannelId, DialLevel, Insight, Module } from './events';

export type ItemState = 'proposed' | 'approved' | 'rejected' | 'merged' | 'released' | 'retracted';

export interface Tracked<T> {
  value: T;
  state: ItemState;
  issues: { code: string; message: string }[];
  critic?: { verdict: 'pass' | 'repair' | 'reject'; reason: string };
  proposedAtWall: string;
  releasedAtWall?: string;
  sentToFacilitator?: boolean;
}

export interface ChannelState {
  level: DialLevel;
  toggles: Record<Module, boolean>;
  mode: 'live' | 'reveal';
  spotlight: string | null;
}

export interface SessionState {
  sessionId: string;
  title: string;
  /** Format id (formats.ts); null until session.started. */
  formatId: string | null;
  seats: Record<string, 'aff' | 'neg' | 'moderator' | 'audience'>;
  source: { kind: 'live' | 'recording'; fixture?: string; url?: string; speed?: number } | null;
  ended: boolean;
  participants: { key: string; displayName: string; role: 'debater' | 'moderator' | 'audience' }[];
  round: { roundId: string; name: string; startedMediaMs: number } | null;
  utterances: Map<string, Utterance>;
  utteranceOrder: string[];
  pendingAttribution: Set<string>;
  adus: Map<string, Tracked<Adu>>;
  propositions: Map<string, Tracked<Proposition>>;
  stances: Map<string, Tracked<Stance>>;
  relations: Map<string, Tracked<Relation>>;
  insights: Map<string, Tracked<Insight>>;
  channels: Record<ChannelId, ChannelState>;
  blackout: boolean;
  lastEventId: string | null;
  lastMediaMs: number;
  eventCount: number;
}

export const DEFAULT_TOGGLES: Record<Module, boolean> = {
  crux: true,
  common_ground: true,
  higher_ground: false, // released deliberately by the facilitator (PRD §6, level 3)
  questions: true,
  credences: true,
  drift: true,
  transcript: true,
  polls: false,
};

export function emptyState(sessionId: string): SessionState {
  const channel = (): ChannelState => ({ level: 0, toggles: { ...DEFAULT_TOGGLES }, mode: 'live', spotlight: null });
  return {
    sessionId,
    title: '',
    formatId: null,
    seats: {},
    source: null,
    ended: false,
    participants: [],
    round: null,
    utterances: new Map(),
    utteranceOrder: [],
    pendingAttribution: new Set(),
    adus: new Map(),
    propositions: new Map(),
    stances: new Map(),
    relations: new Map(),
    insights: new Map(),
    channels: { stage: channel(), livestream: channel(), phones: channel() },
    blackout: false,
    lastEventId: null,
    lastMediaMs: 0,
    eventCount: 0,
  };
}
