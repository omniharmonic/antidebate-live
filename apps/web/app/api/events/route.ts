/**
 * Event ingest for the capture service and the worker (ARCHITECTURE §2.1 step 9, §4.1).
 * POST { events: DomainEvent[] } with `Authorization: Bearer <ROLE_LINK_SECRET>`.
 * Idempotent by eventId. Per-role signed links replace the shared secret in R1 (WS3).
 */
import type { DomainEvent } from '@adl/core';
import { appendEvents, hasDb } from '@adl/db';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const secret = process.env.ROLE_LINK_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!hasDb()) return Response.json({ error: 'DATABASE_URL not configured' }, { status: 503 });
  const body = (await req.json()) as { events?: DomainEvent[] };
  if (!Array.isArray(body.events)) return Response.json({ error: 'expected { events: [] }' }, { status: 400 });
  await appendEvents(body.events);
  return Response.json({ accepted: body.events.length });
}
