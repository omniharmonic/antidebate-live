import 'server-only';
import type { DomainEvent } from '@adl/core';
import { appendEvents, hasDb, readEvents } from '@adl/db';
import { appendLocalEvents, loadLocalEvents } from './events-source';

export async function appendAny(events: DomainEvent[]): Promise<void> {
  if (hasDb()) return appendEvents(events);
  const bySession = new Map<string, DomainEvent[]>();
  for (const e of events) bySession.set(e.sessionId, [...(bySession.get(e.sessionId) ?? []), e]);
  for (const [sid, list] of bySession) appendLocalEvents(sid, list);
}

/** Events after `after` (a db cursor, or a line index locally), at most `limit`. */
export async function readAfter(sessionId: string, after: number, limit: number): Promise<{ events: DomainEvent[]; cursor: number }> {
  if (hasDb()) {
    const rows = await readEvents(sessionId, after, limit);
    return { events: rows.map((r) => r.event), cursor: rows.at(-1)?.cursor ?? after };
  }
  const all = loadLocalEvents(sessionId);
  const events = all.slice(after, after + limit);
  return { events, cursor: after + events.length };
}
