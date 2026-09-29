import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { and, asc, eq, gt } from 'drizzle-orm';
import type { DomainEvent } from '@adl/core';
import * as schema from './schema';

export { schema };

let db: ReturnType<typeof drizzle<typeof schema>> | null = null;
export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  db ??= drizzle(neon(url), { schema });
  return db;
}

export const hasDb = () => Boolean(process.env.DATABASE_URL);

/** Idempotent append (ARCHITECTURE §4.1). */
export async function appendEvents(events: DomainEvent[]): Promise<void> {
  if (events.length === 0) return;
  await getDb()
    .insert(schema.events)
    .values(
      events.map((e) => ({
        eventId: e.eventId,
        sessionId: e.sessionId,
        type: e.type,
        actor: e.actor,
        mediaMs: e.mediaMs,
        wallTs: e.wallTs,
        causedBy: e.causedBy ?? null,
        payload: e.payload as object,
      })),
    )
    .onConflictDoNothing({ target: schema.events.eventId });
}

/** Postgres returns `2026-09-29 02:12:40.603+00`; clients (Safari included) need ISO 8601. */
export function toIso(ts: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)([+-]\d{2})(?::?(\d{2}))?$/.exec(ts);
  const d = m ? new Date(`${m[1]}T${m[2]}${m[3]}:${m[4] ?? '00'}`) : new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toISOString();
}

/** Events after a cursor, in append order. The SSE route tails with this. */
export async function readEvents(sessionId: string, afterId = 0, limit = 500) {
  const rows = await getDb()
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.sessionId, sessionId), gt(schema.events.id, afterId)))
    .orderBy(asc(schema.events.id))
    .limit(limit);
  return rows.map((r) => ({
    cursor: r.id,
    event: {
      eventId: r.eventId,
      sessionId: r.sessionId,
      type: r.type,
      actor: r.actor,
      mediaMs: r.mediaMs,
      wallTs: toIso(r.wallTs),
      ...(r.causedBy ? { causedBy: r.causedBy } : {}),
      payload: r.payload,
    } as DomainEvent,
  }));
}
