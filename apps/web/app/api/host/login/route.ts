/** Host password (spec §3). Sets the signed adl_host cookie for 30 days. */
import { HOST_COOKIE, HOST_COOKIE_TTL_MS, safeEqual, signHostCookie } from '@/lib/host-auth';
import { hostEnv } from '@/lib/host-env';
import { FailureLimiter } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
const limiter = new FailureLimiter(5, 10 * 60_000);

/** Only same-site paths under /host. Normalises URL and rejects dot-dot escapes. */
function safeNext(n: unknown): string {
  if (typeof n !== 'string') return '/host';
  try {
    const url = new URL(n, 'http://x');
    const pathname = url.pathname;
    if (pathname.includes('..') || !(pathname === '/host' || pathname.startsWith('/host/'))) return '/host';
    return pathname;
  } catch {
    return '/host';
  }
}

export async function POST(req: Request) {
  const env = hostEnv();
  if (!env) return Response.json({ error: 'Hosting is not set up on this server yet.' }, { status: 503 });
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const now = Date.now();
  if (limiter.blocked(ip, now)) return Response.json({ error: 'Too many attempts. Wait ten minutes and try again.' }, { status: 429 });
  // Record attempt before any async operation to prevent concurrent bypass
  limiter.fail(ip, now);
  let body: { password?: unknown; next?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: 'body must be JSON' }, { status: 400 });
  }
  if (typeof body.password !== 'string' || !safeEqual(body.password, env.password)) {
    return Response.json({ error: 'That password is not right.' }, { status: 401 });
  }
  limiter.reset(ip);
  const cookie = await signHostCookie(env.secret, now);
  const res = Response.json({ ok: true, next: safeNext(body.next) });
  res.headers.set('set-cookie', `${HOST_COOKIE}=${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${HOST_COOKIE_TTL_MS / 1000}`);
  return res;
}
