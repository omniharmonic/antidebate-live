import { HOST_COOKIE } from '@/lib/host-auth';

export async function POST() {
  const res = Response.json({ ok: true });
  res.headers.set('set-cookie', `${HOST_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  return res;
}
