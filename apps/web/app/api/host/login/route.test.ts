import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

async function post(body: unknown, ip = '1.1.1.1') {
  const { POST } = await import('./route');
  return POST(new Request('http://x/api/host/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify(body) }));
}

describe('POST /api/host/login', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.HOST_PASSWORD = 'lighthaven';
    process.env.HOST_SIGNING_SECRET = 'signing-secret-0123456789';
  });
  it('sets a 30-day HttpOnly cookie on the right password', async () => {
    const res = await post({ password: 'lighthaven', next: '/host/new' });
    expect(res.status).toBe(200);
    const c = res.headers.get('set-cookie') ?? '';
    expect(c).toMatch(/^adl_host=v1\./);
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/Max-Age=2592000/);
    expect(await res.json()).toEqual({ ok: true, next: '/host/new' });
  });
  it('refuses a wrong password, then rate-limits after 5 failures', async () => {
    for (let i = 0; i < 5; i++) expect((await post({ password: 'nope' }, '9.9.9.9')).status).toBe(401);
    expect((await post({ password: 'lighthaven' }, '9.9.9.9')).status).toBe(429);
  });
  it('never redirects off-site', async () => {
    const res = await post({ password: 'lighthaven', next: 'https://evil.example/' });
    expect((await res.json()).next).toBe('/host');
  });
  it('is closed when the secrets are unset', async () => {
    delete process.env.HOST_PASSWORD;
    expect((await post({ password: 'x' })).status).toBe(503);
  });
});
