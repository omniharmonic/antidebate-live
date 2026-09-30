/** Snapshots for fast playback seek (ARCHITECTURE §4.3). */
import type { DomainEvent } from './events';
import { apply } from './reduce';
import { emptyState, type SessionState } from './state';

export const SNAPSHOT_EVERY = 200;

type Json = unknown;

export function serialize(s: SessionState): Json {
  return JSON.parse(
    JSON.stringify(s, (_k, v) => {
      if (v instanceof Map) return { __map: [...v.entries()] };
      if (v instanceof Set) return { __set: [...v.values()] };
      return v;
    }),
  );
}

export function deserialize(j: Json): SessionState {
  return JSON.parse(JSON.stringify(j), (_k, v) => {
    if (v && typeof v === 'object' && '__map' in v) return new Map(v.__map);
    if (v && typeof v === 'object' && '__set' in v) return new Set(v.__set);
    return v;
  }) as SessionState;
}

/** State at media time t: nearest snapshot ≤ t, then replay the remaining events. */
export function stateAt(
  sessionId: string,
  events: readonly DomainEvent[],
  tMs: number,
  snapshots: readonly { atIndex: number; state: Json }[] = [],
): SessionState {
  // Append order and media time differ: delayed analysis and speaker confirmations can
  // follow newer audio. A snapshot is usable only when its entire prefix is in range.
  const prefixMax: number[] = [];
  let maxMs = -Infinity;
  for (const e of events) { maxMs = Math.max(maxMs, e.mediaMs); prefixMax.push(maxMs); }
  let startIdx = 0;
  let s = emptyState(sessionId);
  for (const snap of snapshots) {
    const e = events[snap.atIndex - 1];
    if (e && prefixMax[snap.atIndex - 1]! <= tMs && snap.atIndex > startIdx) {
      startIdx = snap.atIndex;
      s = deserialize(snap.state);
    }
  }
  for (let i = startIdx; i < events.length; i++) {
    const e = events[i]!;
    if (e.mediaMs > tMs) continue;
    s = apply(s, e);
  }
  return s;
}
