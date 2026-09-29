import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import type { DomainEvent, EventOf } from '@adl/core';
import { appendEvents, getDb, hasDb, readEvents, schema } from '@adl/db';
import { appendLocalEvents, loadLocalEvents } from './events-source';

export type SessionFlags = { exists: boolean; host: boolean; ended: boolean };

/** Whether a session exists, was created by the host flow (source.host), and has ended. */
export async function sessionFlags(sessionId: string): Promise<SessionFlags> {
  const t = schema.events;
  const rows: { type: string; payload: unknown }[] = hasDb()
    ? await getDb().select({ type: t.type, payload: t.payload }).from(t).where(and(eq(t.sessionId, sessionId), inArray(t.type, ['session.started', 'session.ended'])))
    : loadLocalEvents(sessionId).filter((e) => e.type === 'session.started' || e.type === 'session.ended');
  const started = rows.find((r) => r.type === 'session.started');
  const source = (started?.payload as EventOf<'session.started'>['payload'] | undefined)?.source;
  return { exists: Boolean(started), host: source?.host === true, ended: rows.some((r) => r.type === 'session.ended') };
}

/** The ids among `ids` already stored for this session. */
export async function knownEventIds(sessionId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  if (hasDb()) {
    const t = schema.events;
    const rows = await getDb().select({ eventId: t.eventId }).from(t).where(and(eq(t.sessionId, sessionId), inArray(t.eventId, ids)));
    return new Set(rows.map((r) => r.eventId));
  }
  const want = new Set(ids);
  return new Set(loadLocalEvents(sessionId).flatMap((e) => (want.has(e.eventId) ? [e.eventId] : [])));
}

export async function appendAny(events: DomainEvent[]): Promise<void> {
  if (hasDb()) return appendEvents(events);
  const bySession = new Map<string, DomainEvent[]>();
  for (const e of events) bySession.set(e.sessionId, [...(bySession.get(e.sessionId) ?? []), e]);
  for (const [sid, list] of bySession) appendLocalEvents(sid, list);
}

/**
 * Events after `after` (a db cursor, or a line index locally), at most `limit`, and whether
 * more follow. The caller pages with the returned cursor until `hasMore` is false.
 */
export async function readAfter(sessionId: string, after: number, limit: number): Promise<{ events: DomainEvent[]; cursor: number; hasMore: boolean }> {
  if (hasDb()) {
    const rows = await readEvents(sessionId, after, limit + 1);
    const page = rows.slice(0, limit);
    return { events: page.map((r) => r.event), cursor: page.at(-1)?.cursor ?? after, hasMore: rows.length > limit };
  }
  const all = loadLocalEvents(sessionId);
  const events = all.slice(after, after + limit);
  return { events, cursor: after + events.length, hasMore: after + events.length < all.length };
}
