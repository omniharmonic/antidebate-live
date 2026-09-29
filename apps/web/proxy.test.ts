import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HOST_COOKIE, signHostCookie } from '@/lib/host-auth';

vi.mock('server-only', () => ({}));

async function getProxy() {
  return import('./proxy');
}

async function testRequest(pathname: string, cookie?: string) {
  const { proxy } = await getProxy();
  const url = new URL(pathname, 'http://localhost');
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  const req = new (await import('next/server')).NextRequest(url, { headers });
  return proxy(req);
}

describe('proxy guard', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.HOST_SIGNING_SECRET = 'signing-secret-0123456789';
  });

  it('redirects /host/new without cookie to /host/login with next param', async () => {
    const res = await testRequest('/host/new');
    expect(res?.status).toBe(307);
    expect(res?.headers.get('location')).toMatch(/\/host\/login\?next=%2Fhost%2Fnew/);
  });

  it('passes /host/login without requiring cookie', async () => {
    const res = await testRequest('/host/login');
    expect(res?.status).toBe(200);
  });

  it('redirects /host/login/subpath without cookie', async () => {
    const res = await testRequest('/host/login/x');
    expect(res?.status).toBe(307);
    expect(res?.headers.get('location')).toContain('/host/login');
  });

  it('passes /host/new with valid cookie', async () => {
    const cookie = await signHostCookie('signing-secret-0123456789', Date.now());
    const res = await testRequest('/host/new', `${HOST_COOKIE}=${cookie}`);
    expect(res?.status).toBe(200);
  });

  it('redirects with expired cookie', async () => {
    const expiredCookie = await signHostCookie('signing-secret-0123456789', Date.now(), -1000);
    const res = await testRequest('/host/new', `${HOST_COOKIE}=${expiredCookie}`);
    expect(res?.status).toBe(307);
  });

  it('redirects with forged cookie', async () => {
    const res = await testRequest('/host/new', `${HOST_COOKIE}=v1.999999999999.fake`);
    expect(res?.status).toBe(307);
  });

  it('redirects when HOST_SIGNING_SECRET is unset', async () => {
    delete process.env.HOST_SIGNING_SECRET;
    const res = await testRequest('/host/new');
    expect(res?.status).toBe(307);
  });

  it('redirects when HOST_SIGNING_SECRET is too short', async () => {
    process.env.HOST_SIGNING_SECRET = 'short';
    const res = await testRequest('/host/new');
    expect(res?.status).toBe(307);
  });
});
