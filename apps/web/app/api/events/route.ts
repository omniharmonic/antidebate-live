/**
 * Event ingest (ARCHITECTURE §2.1 step 9, §4.1). POST { events: DomainEvent[] }.
 *
 * Four tiers, decided per request:
 * - `Authorization: Bearer <ROLE_LINK_SECRET>` (worker): any event type.
 * - `Authorization: Bearer <CAPTURE_TOKEN>` (capture service): CAPTURE_EVENT_TYPES and operator types.
 *   Capture types (utterances, attribution) are rejected with 401 without it, or when CAPTURE_TOKEN is unset.
 * - `Authorization: Bearer <OPERATOR_KEY>` (operator console, /new): OPERATOR_EVENT_TYPES with actor 'operator'.
 * - `Authorization: Bearer v1.<session token>` (host tab, from /api/host/session): any event type except
 *   `session.started`, only for the session the token names, and only for a session the host flow
 *   created (`source.host`). A mixed batch writes nothing (403). Once the session has ended it takes
 *   only `session.published` and retries of events already stored (409 otherwise).
 * - No token: nothing. Every write needs one of these; with a secret unset, its tier is closed.
 * The web app never calls a model, so no request here can spend LLM credits.
 *
 * Idempotent by eventId. Without DATABASE_URL, events append to .data/<session>.events.jsonl.
 */
import type { DomainEvent } from '@adl/core';
import { isValidSessionId } from '@/lib/events-source';
import { appendAny, knownEventIds, readAfter, sessionFlags } from '@/lib/event-store';
import { verifySessionToken } from '@/lib/host-auth';
import { CAPTURE_EVENT_TYPES, OPERATOR_EVENT_TYPES, checkEnvelope, checkOperatorEvent } from '@/lib/operator-events';

export const dynamic = 'force-dynamic';

function bearer(req: Request, secret: string | undefined): boolean {
  return Boolean(secret) && req.headers.get('authorization') === `Bearer ${secret}`;
}

async function sessionFromBearer(req: Request): Promise<string | null> {
  const secret = process.env.HOST_SIGNING_SECRET;
  const auth = req.headers.get('authorization');
  if (!secret || secret.length < 16 || !auth?.startsWith('Bearer v1.')) return null;
  return verifySessionToken(secret, auth.slice('Bearer '.length), Date.now());
}

/** A host token writes only to a host-created session, and after its end only publishes or retries. */
async function hostRefusal(sessionId: string, events: DomainEvent[]): Promise<Response | null> {
  const flags = await sessionFlags(sessionId);
  if (!flags.host) return Response.json({ error: 'this session was not created by a host' }, { status: 403 });
  if (!flags.ended) return null;
  const rest = events.filter((e) => e.type !== 'session.published');
  const known = await knownEventIds(sessionId, rest.map((e) => e.eventId));
  if (rest.some((e) => !known.has(e.eventId))) return Response.json({ error: 'this session has ended' }, { status: 409 });
  return null;
}

export async function POST(req: Request) {
  const worker = bearer(req, process.env.ROLE_LINK_SECRET);
  const capture = bearer(req, process.env.CAPTURE_TOKEN);
  const operator = bearer(req, process.env.OPERATOR_KEY);
  const hostSession = worker || capture || operator ? null : await sessionFromBearer(req);
  if (!worker && !capture && !operator && !hostSession) return Response.json({ error: 'operator key required' }, { status: 401 });

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
    if (hostSession) {
      if (e.sessionId !== hostSession) return Response.json({ error: 'this token is for another session' }, { status: 403 });
      if (e.type === 'session.started') return Response.json({ error: 'session.started is written by the server' }, { status: 403 });
      continue;
    }
    if (capture && CAPTURE_EVENT_TYPES.has(e.type)) continue;
    if (CAPTURE_EVENT_TYPES.has(e.type) && !OPERATOR_EVENT_TYPES.has(e.type)) {
      return Response.json({ error: `${e.type} requires the capture token` }, { status: 401 });
    }
    const problem = checkOperatorEvent(e);
    if (problem) return Response.json({ error: problem }, { status: OPERATOR_EVENT_TYPES.has(e.type) ? 400 : 403 });
  }
  if (hostSession) {
    const refused = await hostRefusal(hostSession, events);
    if (refused) return refused;
  }

  try {
    await appendAny(events);
  } catch (err) {
    console.error('[api/events] append failed', err);
    return Response.json({ error: 'append failed' }, { status: 500 });
  }
  return Response.json({ accepted: events.length });
}

/** Events per resume page: one utterance.final is about 4.5 KB, and Vercel caps a response at 4.5 MB. */
export const RESUME_PAGE = 1000;

/** Resume for a host tab. Raw events need that session's token; audiences only ever get audienceView(). */
export async function GET(req: Request) {
  const sid = await sessionFromBearer(req);
  if (!sid) return Response.json({ error: 'session token required' }, { status: 401 });
  const url = new URL(req.url);
  const sessionId = url.searchParams.get('sessionId') ?? '';
  if (sessionId !== sid) return Response.json({ error: 'this token is for another session' }, { status: 403 });
  const after = Math.max(0, Number(url.searchParams.get('after') ?? 0) || 0);
  return Response.json(await readAfter(sessionId, after, RESUME_PAGE));
}
