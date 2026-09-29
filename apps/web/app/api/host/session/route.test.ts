import { describe, expect, it, vi } from 'vitest';
import { signHostCookie } from '@/lib/host-auth';

vi.mock('server-only', () => ({}));
let cookie: string | undefined;
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => (cookie ? { value: cookie } : undefined) }) }));
const appended: unknown[] = [];
vi.mock('@/lib/event-store', () => ({ appendAny: async (e: unknown[]) => void appended.push(...e) }));

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
    expect(appended).toMatchObject([{ type: 'session.started', sessionId, payload: { source: { kind: 'recording' } } }]);
  });
});
