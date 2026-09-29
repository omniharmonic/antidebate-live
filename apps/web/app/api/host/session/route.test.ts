import { describe, expect, it, vi } from 'vitest';
import { signHostCookie } from '@/lib/host-auth';

vi.mock('server-only', () => ({}));
let cookie: string | undefined;
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => (cookie ? { value: cookie } : undefined) }) }));
const appended: unknown[] = [];
const flags = { exists: true, host: true, ended: false };
vi.mock('@/lib/event-store', () => ({ appendAny: async (e: unknown[]) => void appended.push(...e), sessionFlags: async () => ({ ...flags }) }));

process.env.HOST_PASSWORD = 'pw';
process.env.HOST_SIGNING_SECRET = 'signing-secret-0123456789';
const body = { title: 'Test debate', format: 'anti-debate', participants: [{ key: 'A', displayName: 'Ann', role: 'debater' }], source: { kind: 'recording' } };
const call = async (b: unknown) => (await import('./route')).POST(new Request('http://x', { method: 'POST', body: JSON.stringify(b) }));

describe('POST /api/host/session', () => {
  it('401 without the cookie', async () => {
    cookie = undefined;
    expect((await call(body)).status).toBe(401);
  });
  it('writes session.started and returns a token', async () => {
    cookie = await signHostCookie(process.env.HOST_SIGNING_SECRET!, Date.now());
    const res = await call(body);
    const { sessionId, token } = (await res.json()) as { sessionId: string; token: string };
    expect(token.startsWith(`v1.${sessionId}.`)).toBe(true);
    expect(appended).toMatchObject([{ type: 'session.started', sessionId, payload: { source: { kind: 'recording', host: true } } }]);
  });
  it('re-issues a token only for a session the host flow created', async () => {
    cookie = await signHostCookie(process.env.HOST_SIGNING_SECRET!, Date.now());
    Object.assign(flags, { exists: true, host: true });
    expect((await call({ sessionId: 'mine-20260929-1200' })).status).toBe(200);
    Object.assign(flags, { exists: true, host: false });
    expect((await call({ sessionId: 'showcase' })).status).toBe(403);
    Object.assign(flags, { exists: false, host: false });
    expect((await call({ sessionId: 'nothing-here' })).status).toBe(404);
  });
  it('validates the format and the participants', async () => {
    cookie = await signHostCookie(process.env.HOST_SIGNING_SECRET!, Date.now());
    expect((await call({ ...body, format: 'shouting-match' })).status).toBe(400);
    expect((await call({ ...body, participants: [{ key: 'A', displayName: 'Ann', role: 'king' }] })).status).toBe(400);
    expect((await call({ ...body, participants: [{ key: '', displayName: 'Ann', role: 'debater' }] })).status).toBe(400);
    expect((await call({ ...body, participants: ['Ann'] })).status).toBe(400);
    expect((await call({ ...body, source: { kind: 'stream' } })).status).toBe(400);
  });
});
