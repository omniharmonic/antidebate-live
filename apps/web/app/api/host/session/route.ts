/** Create a host session (spec §3) or re-issue its token. Cookie required. */
import { cookies } from 'next/headers';
import type { DomainEvent } from '@adl/core';
import { HOST_COOKIE, signSessionToken, verifyHostCookie } from '@/lib/host-auth';
import { hostEnv } from '@/lib/host-env';
import { appendAny } from '@/lib/event-store';
import { isValidSessionId, newSessionId } from '@/lib/session-id';

export const dynamic = 'force-dynamic';
type Started = Extract<DomainEvent, { type: 'session.started' }>;

export async function POST(req: Request) {
  const env = hostEnv();
  if (!env) return Response.json({ error: 'Hosting is not set up on this server yet.' }, { status: 503 });
  const jar = await cookies();
  if (!(await verifyHostCookie(env.secret, jar.get(HOST_COOKIE)?.value, Date.now()))) return Response.json({ error: 'Sign in as a host first.' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as (Partial<Started['payload']> & { sessionId?: string }) | null;
  if (!body) return Response.json({ error: 'body must be JSON' }, { status: 400 });

  if (body.sessionId) {
    if (!isValidSessionId(body.sessionId)) return Response.json({ error: 'invalid sessionId' }, { status: 400 });
    return Response.json({ sessionId: body.sessionId, token: await signSessionToken(env.secret, body.sessionId, Date.now()) });
  }
  const title = body.title?.trim();
  if (!title || !body.format || !Array.isArray(body.participants) || body.participants.length === 0) return Response.json({ error: 'title, format and participants are required' }, { status: 400 });
  const sessionId = newSessionId(title);
  const started: Started = {
    eventId: `${sessionId}:start`,
    sessionId,
    type: 'session.started',
    actor: 'operator',
    mediaMs: 0,
    wallTs: new Date().toISOString(),
    payload: { title, format: body.format, participants: body.participants, ...(body.seats ? { seats: body.seats } : {}), source: body.source ?? { kind: 'live' } },
  };
  await appendAny([started]);
  return Response.json({ sessionId, token: await signSessionToken(env.secret, sessionId, Date.now()) });
}
