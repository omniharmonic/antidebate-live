/**
 * Host access (spec §3). A signed cookie proves the host password was entered on this
 * device; a session token lets that host's tab write events for one session only.
 * Web Crypto only, so it runs in proxy.ts and in route handlers alike.
 */
export const HOST_COOKIE = 'adl_host';
export const HOST_COOKIE_TTL_MS = 30 * 24 * 3600 * 1000;
export const SESSION_TOKEN_TTL_MS = 24 * 3600 * 1000;

const enc = new TextEncoder();

function b64url(buf: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}

/** Constant-time string compare. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function signHostCookie(secret: string, nowMs: number, ttlMs = HOST_COOKIE_TTL_MS): Promise<string> {
  const exp = nowMs + ttlMs;
  return `v1.${exp}.${await hmac(secret, `host.v1.${exp}`)}`;
}

export async function verifyHostCookie(secret: string, value: string | undefined, nowMs: number): Promise<boolean> {
  const m = value?.match(/^v1\.(\d+)\.([A-Za-z0-9_-]+)$/);
  if (!m) return false;
  const exp = Number(m[1]);
  if (!(exp > nowMs)) return false;
  return safeEqual(m[2]!, await hmac(secret, `host.v1.${exp}`));
}

export async function signSessionToken(secret: string, sessionId: string, nowMs: number, ttlMs = SESSION_TOKEN_TTL_MS): Promise<string> {
  const exp = nowMs + ttlMs;
  return `v1.${sessionId}.${exp}.${await hmac(secret, `session.v1.${sessionId}.${exp}`)}`;
}

export async function verifySessionToken(secret: string, token: string | undefined, nowMs: number): Promise<string | null> {
  const m = token?.match(/^v1\.(.+)\.(\d+)\.([A-Za-z0-9_-]+)$/);
  if (!m) return null;
  const [, sessionId, expRaw, sig] = m as unknown as [string, string, string, string];
  const exp = Number(expRaw);
  if (!(exp > nowMs)) return null;
  return safeEqual(sig, await hmac(secret, `session.v1.${sessionId}.${exp}`)) ? sessionId : null;
}
