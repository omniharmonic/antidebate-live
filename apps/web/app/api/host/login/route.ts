/** Host password (spec §3). Sets the signed adl_host cookie for 30 days. */
import { HOST_COOKIE, HOST_COOKIE_TTL_MS, safeEqual, signHostCookie } from '@/lib/host-auth';
import { hostEnv } from '@/lib/host-env';
import { FailureLimiter } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
const limiter = new FailureLimiter(5, 10 * 60_000);

/** Only same-site paths under /host. */
function safeNext(n: unknown): string {
  return typeof n === 'string' && /^\/host(\/[\w\-./]*)?$/.test(n) ? n : '/host';
}

export async function POST(req: Request) {
  const env = hostEnv();
  if (!env) return Response.json({ error: 'Hosting is not set up on this server yet.' }, { status: 503 });
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const now = Date.now();
  if (limiter.blocked(ip, now)) return Response.json({ error: 'Too many attempts. Wait ten minutes and try again.' }, { status: 429 });
  let body: { password?: unknown; next?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: 'body must be JSON' }, { status: 400 });
  }
  if (typeof body.password !== 'string' || !safeEqual(body.password, env.password)) {
    limiter.fail(ip, now);
    return Response.json({ error: 'That password is not right.' }, { status: 401 });
  }
  limiter.reset(ip);
  const cookie = await signHostCookie(env.secret, now);
  const res = Response.json({ ok: true, next: safeNext(body.next) });
  res.headers.set('set-cookie', `${HOST_COOKIE}=${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${HOST_COOKIE_TTL_MS / 1000}`);
  return res;
}
