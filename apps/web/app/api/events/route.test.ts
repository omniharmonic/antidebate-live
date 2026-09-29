import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signSessionToken } from '@/lib/host-auth';

vi.mock('server-only', () => ({}));
const appended: unknown[] = [];
vi.mock('@/lib/event-store', () => ({
  appendAny: async (e: unknown[]) => void appended.push(...e),
  readAfter: async () => ({ events: [{ eventId: 'a:1' }], cursor: 7 }),
}));

const SECRET = 'signing-secret-0123456789';
const ev = (sessionId: string, type = 'utterance.final') => ({ eventId: `${sessionId}:x${Math.random()}`, sessionId, type, actor: 'system', mediaMs: 0, wallTs: new Date().toISOString(), payload: {} });
const req = (token: string | null, events: unknown[]) =>
  new Request('http://x/api/events', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ events }) });

describe('/api/events session tier', () => {
  beforeEach(() => {
    process.env.HOST_SIGNING_SECRET = SECRET;
    appended.length = 0;
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
    const ok = await GET(new Request('http://x/api/events?sessionId=sess-a&after=0', { headers: { authorization: `Bearer ${t}` } }));
    expect(await ok.json()).toEqual({ events: [{ eventId: 'a:1' }], cursor: 7 });
  });
});
