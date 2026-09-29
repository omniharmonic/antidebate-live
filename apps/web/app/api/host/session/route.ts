/** Create a host session (spec §3) or re-issue its token. Cookie required. */
import { cookies } from 'next/headers';
import { FORMATS, type DomainEvent } from '@adl/core';
import { HOST_COOKIE, signSessionToken, verifyHostCookie } from '@/lib/host-auth';
import { hostEnv } from '@/lib/host-env';
import { appendAny, sessionFlags } from '@/lib/event-store';
import { isValidSessionId, newSessionId } from '@/lib/session-id';

export const dynamic = 'force-dynamic';
type Started = Extract<DomainEvent, { type: 'session.started' }>;
type Participant = Started['payload']['participants'][number];

const ROLES = new Set(['debater', 'moderator', 'audience']);
const isParticipant = (p: unknown): p is Participant => {
  const x = p as Partial<Participant> | null;
  return Boolean(x) && typeof x!.key === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(x!.key) && typeof x!.displayName === 'string' && x!.displayName.trim() !== '' && ROLES.has(x!.role as string);
};

/** What is wrong with a new-session body, or null. */
function invalid(b: Partial<Started['payload']>): string | null {
  if (!b.title?.trim()) return 'a title is required';
  if (!b.format || !Object.hasOwn(FORMATS, b.format)) return 'unknown format';
  if (!Array.isArray(b.participants) || b.participants.length === 0 || !b.participants.every(isParticipant)) return 'participants need a key, a name and a role';
  if (new Set(b.participants.map((p) => p.key)).size !== b.participants.length) return 'participant keys must be unique';
  if (b.source !== undefined && b.source?.kind !== 'recording' && b.source?.kind !== 'live') return "source.kind must be 'recording' or 'live'";
  if (b.source?.attribution !== undefined && b.source.attribution !== 'voice') return "source.attribution must be 'voice' when given";
  return null;
}

export async function POST(req: Request) {
  const env = hostEnv();
  if (!env) return Response.json({ error: 'Hosting is not set up on this server yet.' }, { status: 503 });
  const jar = await cookies();
  if (!(await verifyHostCookie(env.secret, jar.get(HOST_COOKIE)?.value, Date.now()))) return Response.json({ error: 'Sign in as a host first.' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as (Partial<Started['payload']> & { sessionId?: string }) | null;
  if (!body) return Response.json({ error: 'body must be JSON' }, { status: 400 });

  if (body.sessionId) {
    if (!isValidSessionId(body.sessionId)) return Response.json({ error: 'invalid sessionId' }, { status: 400 });
    // Only sessions the host flow created: never the showcase debates or an operator's live room.
    const flags = await sessionFlags(body.sessionId);
    if (!flags.exists) return Response.json({ error: 'This session was not found.' }, { status: 404 });
    if (!flags.host) return Response.json({ error: 'This session was not created by a host.' }, { status: 403 });
    return Response.json({ sessionId: body.sessionId, token: await signSessionToken(env.secret, body.sessionId, Date.now()) });
  }
  const problem = invalid(body);
  if (problem) return Response.json({ error: problem }, { status: 400 });
  const title = body.title!.trim();
  const sessionId = newSessionId(title);
  const started: Started = {
    eventId: `${sessionId}:start`,
    sessionId,
    type: 'session.started',
    actor: 'operator',
    mediaMs: 0,
    wallTs: new Date().toISOString(),
    payload: {
      title,
      format: body.format!,
      participants: body.participants!.map(({ key, displayName, role }) => ({ key, displayName: displayName.trim(), role })),
      ...(body.seats ? { seats: body.seats } : {}),
      source: { kind: body.source?.kind ?? 'live', host: true, ...(body.source?.attribution === 'voice' ? { attribution: 'voice' as const } : {}) },
    },
  };
  await appendAny([started]);
  return Response.json({ sessionId, token: await signSessionToken(env.secret, sessionId, Date.now()) });
}
