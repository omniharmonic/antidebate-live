/**
 * Event ingest (ARCHITECTURE §2.1 step 9, §4.1). POST { events: DomainEvent[] }.
 *
 * Three tiers, decided per request:
 * - `Authorization: Bearer <ROLE_LINK_SECRET>` (worker): any event type.
 * - `Authorization: Bearer <CAPTURE_TOKEN>` (capture service): CAPTURE_EVENT_TYPES and operator types.
 *   Capture types (utterances, attribution) are rejected with 401 without it, or when CAPTURE_TOKEN is unset.
 * - No token (operator console, /new): OPERATOR_EVENT_TYPES with actor 'operator' only.
 *   Unauthenticated in R0; per-role signed links replace this in R1 (WS3).
 *
 * Idempotent by eventId. Without DATABASE_URL, events append to .data/<session>.events.jsonl.
 */
import type { DomainEvent } from '@adl/core';
import { appendEvents, hasDb } from '@adl/db';
import { appendLocalEvents, isValidSessionId } from '@/lib/events-source';
import { CAPTURE_EVENT_TYPES, OPERATOR_EVENT_TYPES, checkEnvelope, checkOperatorEvent } from '@/lib/operator-events';

export const dynamic = 'force-dynamic';

function bearer(req: Request, secret: string | undefined): boolean {
  return Boolean(secret) && req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function POST(req: Request) {
  const worker = bearer(req, process.env.ROLE_LINK_SECRET);
  const capture = bearer(req, process.env.CAPTURE_TOKEN);

  let body: { events?: unknown };
  try {
    body = (await req.json()) as { events?: unknown };
  } catch {
    return Response.json({ error: 'body must be JSON' }, { status: 400 });
  }
  if (!Array.isArray(body.events) || body.events.length === 0) return Response.json({ error: 'expected { events: [...] }' }, { status: 400 });
  if (body.events.length > 5000) return Response.json({ error: 'at most 5000 events per request' }, { status: 413 });

  const events = body.events as DomainEvent[];
  for (const e of events) {
    const bad = checkEnvelope(e);
    if (bad) return Response.json({ error: bad }, { status: 400 });
    if (!isValidSessionId(e.sessionId)) return Response.json({ error: 'invalid sessionId' }, { status: 400 });
    if (worker) continue;
    if (capture && CAPTURE_EVENT_TYPES.has(e.type)) continue;
    if (CAPTURE_EVENT_TYPES.has(e.type) && !OPERATOR_EVENT_TYPES.has(e.type)) {
      return Response.json({ error: `${e.type} requires the capture token` }, { status: 401 });
    }
    const problem = checkOperatorEvent(e);
    if (problem) return Response.json({ error: problem }, { status: OPERATOR_EVENT_TYPES.has(e.type) ? 400 : 403 });
  }

  try {
    if (hasDb()) {
      await appendEvents(events);
    } else {
      const bySession = new Map<string, DomainEvent[]>();
      for (const e of events) bySession.set(e.sessionId, [...(bySession.get(e.sessionId) ?? []), e]);
      for (const [sid, list] of bySession) appendLocalEvents(sid, list);
    }
  } catch (err) {
    console.error('[api/events] append failed', err);
    return Response.json({ error: 'append failed' }, { status: 500 });
  }
  return Response.json({ accepted: events.length });
}
