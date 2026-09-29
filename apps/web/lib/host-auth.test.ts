import { describe, expect, it } from 'vitest';
import { signHostCookie, signSessionToken, verifyHostCookie, verifySessionToken, HOST_COOKIE_TTL_MS } from './host-auth';

const S = 'test-secret-0123456789';
const T0 = Date.parse('2026-09-29T12:00:00Z');

describe('host cookie', () => {
  it('verifies its own cookie', async () => {
    expect(await verifyHostCookie(S, await signHostCookie(S, T0), T0 + 1000)).toBe(true);
  });
  it('rejects expiry, tampering, other secrets and junk', async () => {
    const c = await signHostCookie(S, T0);
    expect(await verifyHostCookie(S, c, T0 + HOST_COOKIE_TTL_MS + 1)).toBe(false);
    const [v, exp, sig] = c.split('.');
    expect(await verifyHostCookie(S, `${v}.${Number(exp) + 1}.${sig}`, T0)).toBe(false);
    expect(await verifyHostCookie('other-secret-xxxxxxxx', c, T0)).toBe(false);
    for (const junk of [undefined, '', 'v1', 'v1..', 'v2.1.x']) expect(await verifyHostCookie(S, junk, T0)).toBe(false);
  });
});

describe('session token', () => {
  it('returns the session id it was signed for', async () => {
    const t = await signSessionToken(S, '2026-09-29-demo.run', T0);
    expect(await verifySessionToken(S, t, T0 + 1000)).toBe('2026-09-29-demo.run');
  });
  it('cannot be re-pointed at another session', async () => {
    const t = await signSessionToken(S, 'a', T0);
    const forged = t.replace(/^v1\.a\./, 'v1.b.');
    expect(await verifySessionToken(S, forged, T0)).toBeNull();
  });
  it('a host cookie is not a session token and vice versa', async () => {
    expect(await verifySessionToken(S, await signHostCookie(S, T0), T0)).toBeNull();
    expect(await verifyHostCookie(S, await signSessionToken(S, 'a', T0), T0)).toBe(false);
  });
});
