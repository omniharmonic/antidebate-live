import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signSessionToken } from '@/lib/host-auth';

vi.mock('server-only', () => ({}));
const appended: unknown[] = [];
const flags = { exists: true, host: true, ended: false };
const known = new Set<string>();
const reads: { after: number; limit: number }[] = [];
vi.mock('@/lib/event-store', () => ({
  appendAny: async (e: unknown[]) => void appended.push(...e),
  readAfter: async (_sid: string, after: number, limit: number) => {
    reads.push({ after, limit });
    return { events: [{ eventId: 'a:1' }], cursor: after + 1, hasMore: true };
  },
  sessionFlags: async () => ({ ...flags }),
  knownEventIds: async (_sid: string, ids: string[]) => new Set(ids.filter((i) => known.has(i))),
}));

const SECRET = 'signing-secret-0123456789';
const ev = (sessionId: string, type = 'utterance.final') => ({ eventId: `${sessionId}:x${Math.random()}`, sessionId, type, actor: 'system', mediaMs: 0, wallTs: new Date().toISOString(), payload: {} });
const req = (token: string | null, events: unknown[]) =>
  new Request('http://x/api/events', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ events }) });

describe('/api/events session tier', () => {
  beforeEach(() => {
    process.env.HOST_SIGNING_SECRET = SECRET;
    appended.length = 0;
    Object.assign(flags, { exists: true, host: true, ended: false });
    known.clear();
  });
  it('accepts pipeline events for its own session', async () => {
    const { POST } = await import('./route');
    const t = await signSessionToken(SECRET, 'sess-a', Date.now());
    const res = await POST(req(t, [ev('sess-a'), ev('sess-a', 'insight.proposed')]));
    expect(res.status).toBe(200);
    expect(appended).toHaveLength(2);
  });
  it('refuses another session with 403 and writes nothing', async () => {
    const { POST } = await import('./route');
    const t = await signSessionToken(SECRET, 'sess-a', Date.now());
    expect((await POST(req(t, [ev('sess-a'), ev('sess-b')]))).status).toBe(403);
    expect(appended).toHaveLength(0);
  });
  it('refuses session.started (the server writes it)', async () => {
    const { POST } = await import('./route');
    const t = await signSessionToken(SECRET, 'sess-a', Date.now());
    expect((await POST(req(t, [ev('sess-a', 'session.started')]))).status).toBe(403);
  });
  it('still refuses anonymous writes', async () => {
    const { POST } = await import('./route');
    expect((await POST(req(null, [ev('sess-a')]))).status).toBe(401);
  });
  it('GET needs the token for that session', async () => {
    const { GET } = await import('./route');
    const t = await signSessionToken(SECRET, 'sess-a', Date.now());
    expect((await GET(new Request('http://x/api/events?sessionId=sess-a&after=0'))).status).toBe(401);
    expect((await GET(new Request('http://x/api/events?sessionId=sess-b&after=0', { headers: { authorization: `Bearer ${t}` } }))).status).toBe(403);
    reads.length = 0;
    const ok = await GET(new Request('http://x/api/events?sessionId=sess-a&after=6', { headers: { authorization: `Bearer ${t}` } }));
    expect(await ok.json()).toEqual({ events: [{ eventId: 'a:1' }], cursor: 7, hasMore: true });
    // Pages of 1000: one utterance.final is about 4.5 KB and Vercel caps a response at 4.5 MB.
    expect(reads).toEqual([{ after: 6, limit: 1000 }]);
  });
  it('refuses a session the host flow did not create', async () => {
    const { POST } = await import('./route');
    flags.host = false;
    const t = await signSessionToken(SECRET, 'sess-a', Date.now());
    expect((await POST(req(t, [ev('sess-a')]))).status).toBe(403);
    expect(appended).toHaveLength(0);
  });
  it('refuses new events once the session has ended', async () => {
    const { POST } = await import('./route');
    flags.ended = true;
    const t = await signSessionToken(SECRET, 'sess-a', Date.now());
    expect((await POST(req(t, [ev('sess-a', 'insight.proposed')]))).status).toBe(409);
    expect(appended).toHaveLength(0);
  });
  it('after the end, a retry of stored events stays idempotent and publishing is allowed', async () => {
    const { POST } = await import('./route');
    flags.ended = true;
    const t = await signSessionToken(SECRET, 'sess-a', Date.now());
    const retry = ev('sess-a');
    known.add(retry.eventId);
    expect((await POST(req(t, [retry]))).status).toBe(200);
    expect((await POST(req(t, [{ ...ev('sess-a', 'session.published'), actor: 'operator', payload: { published: true } }]))).status).toBe(200);
    expect((await POST(req(t, [retry, ev('sess-a')]))).status).toBe(409);
  });
});
