/** /host/** needs the host cookie (spec §3). /host/login is open. Next 16: this file replaces middleware. */
import { NextResponse, type NextRequest } from 'next/server';
import { HOST_COOKIE, verifyHostCookie } from '@/lib/host-auth';

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname === '/host/login') return NextResponse.next();
  const secret = process.env.HOST_SIGNING_SECRET;
  const ok = Boolean(secret) && secret!.length >= 16 && (await verifyHostCookie(secret!, request.cookies.get(HOST_COOKIE)?.value, Date.now()));
  if (ok) return NextResponse.next();
  const url = new URL('/host/login', request.url);
  url.searchParams.set('next', `${pathname}${search}`);
  return NextResponse.redirect(url);
}

export const config = { matcher: ['/host', '/host/:path*'] };
