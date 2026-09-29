# Host Onboarding, Plan 1: Access, Bring-Your-Own Key, Browser Engine, Recordings

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An approved host signs in with the shared password, adds their own Anthropic key, drops in a recording, names the voices, and gets a full argument map on `antidebate.xyz`. Everything runs in their Chrome tab; nothing is installed.

**Architecture:**
- The server does three things only: it checks the host password (signed cookie), issues per-session write tokens, and stores and streams events.
- The host's tab does the rest:
  - decodes the file;
  - separates speakers (sherpa-onnx WASM);
  - transcribes (parakeet.js);
  - builds `utterance.final` events;
  - runs the existing `SessionEngine` with `@adl/llm`'s new browser transport and the host's key;
  - POSTs every event with the session token.

**Tech Stack:**
- Next.js 16.3.6 (`proxy.ts`, route handlers), React 19.3
- `@anthropic-ai/sdk` ^0.129 (browser mode)
- parakeet.js 1.4.4
- sherpa-onnx WASM speaker-diarization bundle v1.13.7 (prebuilt release asset)
- Web Crypto HMAC, IndexedDB
- Vitest

**Spec:** `docs/superpowers/specs/2026-09-29-host-onboarding-design.md`

**Plan series:**
- This is Plan 1 of 3. It covers spec §3, §4, §7, §8 (login, key, prepare, host home, new, runner) and the recording setup in §6.4.
- Plan 2 (written after this lands): live setups §6.1–6.3, the live attributor with enrollment (§5), and the rehearsal.
- Plan 3: the attribution quality gate (§5 gate), plus hardware and laptop measurements (§10 manual).

## Global Constraints

- Model ids and effort stay in `packages/llm/src/models.ts` only. Default `claude-sonnet-5-5`. Do not change models or effort.
- The host's Anthropic key never reaches our server: no request to `antidebate.xyz` may carry it, and nothing logs it.
- Audience routes (`/stage`, `/overlay`, `/p`, `/s/*` public views, `/api/events/stream`) serve only `audienceView()` output, as today. The new `GET /api/events` requires a session token.
- The event log is append-only and idempotent by `eventId`. Reducers stay pure. `packages/core` gets no clocks or randomness.
- Attribution uses the existing ontology: `Utterance.attribution {confidence, signals, confirmedBy: 'auto'|'operator'|'fixture'}`, with `attribution.pending` below 0.85. No ontology change.
- Copy follows UX §2: plain sentences, no filler, no emoji, no gradients, no unverifiable numbers. The only cost figure shown is "about $12–15 for a 90-minute debate (measured 2026-09-28)".
- Next 16: route `params` are Promises. The auth file is `proxy.ts`, not middleware.
- TypeScript strict, ESM, `verbatimModuleSyntax` (`import type`). Tests are Vitest files next to the code.
- No test or dev step spends API credits. Real-key checks happen only with Benjamin's explicit approval, on his key.
- Commits are small. Every message ends with:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01CYUg7EySnK7CEwrGpq9YGC
  ```

## Review Focus

1. **A session token used on another session.** A host token for session A posting events for session B must get 403, never 200. Test: Task 3.
2. **The host reloads or closes the tab mid-recording.** On reopening `/host/s/<id>`, processing resumes from the last finished chunk and turn, with no duplicate events (same eventIds) and no restart from zero. Test: Tasks 7 and 12.
3. **Key check network failure vs bad key.** An offline laptop must say "The browser couldn't reach Anthropic", not "That key wasn't accepted". Test: Task 8.
4. **A recording with more voices than named people** (audience question, a guest). Unnamed clusters become `UNK` utterances with `attribution.pending`. They never enter the map as a debater's claims. Test: Task 11.
5. **Cookie tampering or expiry.** A forged, altered or expired `adl_host` cookie redirects to login. It never passes. Test: Task 1.

---

## File map

| File | Responsibility |
|---|---|
| `apps/web/lib/host-auth.ts` | Sign and verify the host cookie and session tokens (Web Crypto HMAC). Pure, and usable in `proxy.ts` and route handlers. |
| `apps/web/lib/rate-limit.ts` | In-memory failure counter per key. |
| `apps/web/app/api/host/login/route.ts`, `logout/route.ts` | Set and clear the `adl_host` cookie. |
| `apps/web/proxy.ts` | Guards `/host/**` except `/host/login`. |
| `apps/web/app/api/host/session/route.ts` | Creates a session (`session.started`) and returns its token. Re-issues a token for an existing session. |
| `apps/web/app/api/events/route.ts` | Adds the session-token tier to POST, and a token-guarded GET for resume. |
| `apps/web/lib/sessions.ts`, `apps/web/app/page.tsx` | The public list shows ended sessions only. |
| `packages/llm/src/{core,node,browser,index,index.browser}.ts` | The transport seam: the Node path unchanged, plus a browser path using the host's key. |
| `packages/engine/` | `SessionEngine`, the `EventLog` interface and `HttpEventLog`. Shared by `apps/worker` and the web host runner. |
| `apps/web/lib/anthropic-key.ts` | Key storage, the check call, and error → message mapping. |
| `apps/web/lib/audio/decode.ts` | File → 16 kHz mono Float32Array per channel. |
| `apps/web/lib/asr/chunks.ts` | 60 s window plan and word merge across overlaps. Pure. |
| `apps/web/lib/asr/asr.worker.ts`, `apps/web/lib/asr/client.ts` | The parakeet.js model in a Web Worker, behind a promise API. |
| `apps/web/scripts/fetch-sherpa.mjs`, `apps/web/public/sherpa/` (gitignored) | Downloads the prebuilt diarization bundle at build time. |
| `apps/web/lib/diarize/diarize.worker.ts`, `apps/web/lib/diarize/client.ts` | Offline diarization in a worker. |
| `apps/web/lib/recording/utterances.ts` | Words plus speaker segments → `utterance.final` / `attribution.pending` events. Pure. |
| `apps/web/lib/recording/checkpoint.ts` | IndexedDB store for chunk results, the voice map and the outbox. |
| `apps/web/lib/recording/pipeline.ts` | Orchestrates one recording: diarize → name voices → ASR chunks → events → engine. |
| `apps/web/app/host/**` | Screens: login, key, prepare, home, new, the session runner. |

---

### Task 1: Host cookie and session tokens

**Files:**
- Create: `apps/web/lib/host-auth.ts`, `apps/web/lib/host-auth.test.ts`, `apps/web/vitest.config.ts`
- Modify: `apps/web/package.json` (devDependency `vitest`, `vite-tsconfig-paths`)

**Interfaces:**
- Produces:
  - `signHostCookie(secret: string, nowMs: number, ttlMs?: number): Promise<string>`
  - `verifyHostCookie(secret: string, value: string | undefined, nowMs: number): Promise<boolean>`
  - `signSessionToken(secret: string, sessionId: string, nowMs: number, ttlMs?: number): Promise<string>`
  - `verifySessionToken(secret: string, token: string | undefined, nowMs: number): Promise<string | null>`, which returns the sessionId or null
  - `HOST_COOKIE = 'adl_host'`
  - `HOST_COOKIE_TTL_MS = 30 days`
  - `SESSION_TOKEN_TTL_MS = 24 h`

- [ ] **Step 1: Add the Vitest config for the web app** (so `@/` resolves)

```ts
// apps/web/vitest.config.ts
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({ plugins: [tsconfigPaths()], test: { environment: 'node' } });
```

Run: `pnpm --filter @adl/web add -D vitest vite-tsconfig-paths`

- [ ] **Step 2: Write the failing tests**

```ts
// apps/web/lib/host-auth.test.ts
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
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `pnpm --filter @adl/web test -- host-auth`
Expected: FAIL, "Cannot find module './host-auth'".

- [ ] **Step 4: Implement**

```ts
// apps/web/lib/host-auth.ts
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
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `pnpm --filter @adl/web test -- host-auth`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/host-auth.ts apps/web/lib/host-auth.test.ts apps/web/vitest.config.ts apps/web/package.json pnpm-lock.yaml
git commit -m "web: signed host cookie and per-session write tokens"
```

---

### Task 2: Password login, logout and the `/host` guard

**Files:**
- Create:
  - `apps/web/lib/rate-limit.ts`
  - `apps/web/app/api/host/login/route.ts` and `route.test.ts`
  - `apps/web/app/api/host/logout/route.ts`
  - `apps/web/proxy.ts`
  - `apps/web/app/host/login/page.tsx` and `LoginForm.tsx`
  - `apps/web/lib/host-env.ts`
- Modify: `.env.example` (add `HOST_PASSWORD=`, `HOST_SIGNING_SECRET=`)

**Interfaces:**
- Consumes: Task 1 (`signHostCookie`, `verifyHostCookie`, `safeEqual`, `HOST_COOKIE`, `HOST_COOKIE_TTL_MS`).
- Produces:
  - `POST /api/host/login {password, next?}` → 200 `{ok:true,next}` and sets the cookie; 401 `{error}`; 429 `{error}`; 503 when env is unset.
  - `POST /api/host/logout` → clears the cookie.
  - `hostEnv(): {password: string, secret: string} | null`

- [ ] **Step 1: Write the env helper and the rate limiter**

```ts
// apps/web/lib/host-env.ts
import 'server-only';
/** Both secrets must be set, or hosting is closed (never open by default). */
export function hostEnv(): { password: string; secret: string } | null {
  const password = process.env.HOST_PASSWORD;
  const secret = process.env.HOST_SIGNING_SECRET;
  return password && secret && secret.length >= 16 ? { password, secret } : null;
}
```

```ts
// apps/web/lib/rate-limit.ts
/** Failures per key in a sliding window. In-memory per instance: enough for one shared password. */
export class FailureLimiter {
  private hits = new Map<string, number[]>();
  constructor(private readonly max: number, private readonly windowMs: number) {}
  blocked(key: string, now: number): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    this.hits.set(key, recent);
    return recent.length >= this.max;
  }
  fail(key: string, now: number): void {
    this.hits.set(key, [...(this.hits.get(key) ?? []), now]);
  }
  reset(key: string): void {
    this.hits.delete(key);
  }
}
```

- [ ] **Step 2: Write the failing route test**

```ts
// apps/web/app/api/host/login/route.test.ts
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
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `pnpm --filter @adl/web test -- login`
Expected: FAIL, "Cannot find module './route'".

- [ ] **Step 4: Implement the routes**

```ts
// apps/web/app/api/host/login/route.ts
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
```

```ts
// apps/web/app/api/host/logout/route.ts
import { HOST_COOKIE } from '@/lib/host-auth';

export async function POST() {
  const res = Response.json({ ok: true });
  res.headers.set('set-cookie', `${HOST_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  return res;
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `pnpm --filter @adl/web test -- login`
Expected: PASS (4 tests).

- [ ] **Step 6: Add the proxy guard**

```ts
// apps/web/proxy.ts
/** /host/** needs the host cookie (spec §3). /host/login is open. Next 16: this file replaces middleware. */
import { NextResponse, type NextRequest } from 'next/server';
import { HOST_COOKIE, verifyHostCookie } from '@/lib/host-auth';

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname === '/host/login') return NextResponse.next();
  const secret = process.env.HOST_SIGNING_SECRET;
  const ok = Boolean(secret) && (await verifyHostCookie(secret!, request.cookies.get(HOST_COOKIE)?.value, Date.now()));
  if (ok) return NextResponse.next();
  const url = new URL('/host/login', request.url);
  url.searchParams.set('next', `${pathname}${search}`);
  return NextResponse.redirect(url);
}

export const config = { matcher: ['/host', '/host/:path*'] };
```

- [ ] **Step 7: Build the login page**

```tsx
// apps/web/app/host/login/page.tsx
import type { Metadata } from 'next';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Host sign-in · Anti-Debate Live' };

export default async function HostLogin({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="min-h-dvh bg-field">
      <div className="mx-auto max-w-md px-6 pb-20 pt-24">
        <h1 className="text-[30px] leading-tight text-ink">Host a session</h1>
        <p className="mt-3 text-[15px] text-ink-2">Hosting is for invited facilitators. Enter the host password you were given. This device stays signed in for 30 days.</p>
        <div className="mt-8">
          <LoginForm next={next ?? '/host'} />
        </div>
      </div>
    </main>
  );
}
```

```tsx
// apps/web/app/host/login/LoginForm.tsx
'use client';

import { useState } from 'react';

export function LoginForm({ next }: { next: string }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const res = await fetch('/api/host/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password, next }) });
          const body = (await res.json()) as { next?: string; error?: string };
          if (!res.ok) return setError(body.error ?? 'Sign-in failed.');
          window.location.assign(body.next ?? '/host');
        } catch {
          setError('Could not reach the server. Check the connection and try again.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="block text-sm text-ink-2" htmlFor="pw">Host password</label>
      <input id="pw" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)}
        className="min-h-11 w-full rounded-[3px] border border-border bg-surface px-3 py-2 text-[16px] focus:border-focus" />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button type="submit" disabled={busy} className="min-h-11 rounded border border-border-2 px-4 text-[15px] hover:bg-field-deep disabled:opacity-50">
        {busy ? 'Checking…' : 'Sign in'}
      </button>
    </form>
  );
}
```

- [ ] **Step 8: Check the guard by hand**

Run: `HOST_PASSWORD=test HOST_SIGNING_SECRET=0123456789abcdef0123 pnpm dev`, then:
- `curl -sI http://localhost:3000/host/new | grep -i location` → `/host/login?next=%2Fhost%2Fnew`
- `curl -sI http://localhost:3000/host/login` → 200

- [ ] **Step 9: Commit**

```bash
git add apps/web/lib/host-env.ts apps/web/lib/rate-limit.ts apps/web/app/api/host apps/web/proxy.ts apps/web/app/host/login .env.example
git commit -m "web: host password sign-in with a 30-day cookie; /host guarded by proxy"
```

---

### Task 3: Session creation, and the session-token tier on `/api/events`

**Files:**
- Create:
  - `apps/web/app/api/host/session/route.ts` and `route.test.ts`
  - `apps/web/lib/event-store.ts`
- Modify:
  - `apps/web/app/api/events/route.ts` (the POST tier, and a new GET)
  - `apps/web/app/api/events/route.test.ts` (create)

**Interfaces:**
- Consumes: Task 1 (`verifyHostCookie`, `signSessionToken`, `verifySessionToken`), Task 2 (`hostEnv`).
- Produces:
  - `POST /api/host/session` (cookie). Body: `{title, format, participants, seats?, source: {kind:'recording'|'live', file?: string}}` → `{sessionId, token}`.
  - `POST /api/host/session` with `{sessionId}` re-issues a token for an existing session.
  - `POST /api/events` with `Bearer <sessionToken>` accepts any event type except `session.started`, only for that session.
  - `GET /api/events?sessionId=&after=` with `Bearer <sessionToken>` → `{events: DomainEvent[], cursor: number}` (up to 5000).
  - `appendAny(events)` and `readAfter(sessionId, after, limit)` in `lib/event-store.ts`, covering Neon and the local JSONL.

- [ ] **Step 1: Extract the storage helper** (the POST body today appends inline; GET needs the same two backends)

```ts
// apps/web/lib/event-store.ts
import 'server-only';
import type { DomainEvent } from '@adl/core';
import { appendEvents, hasDb, readEvents } from '@adl/db';
import { appendLocalEvents, loadLocalEvents } from './events-source';

export async function appendAny(events: DomainEvent[]): Promise<void> {
  if (hasDb()) return appendEvents(events);
  const bySession = new Map<string, DomainEvent[]>();
  for (const e of events) bySession.set(e.sessionId, [...(bySession.get(e.sessionId) ?? []), e]);
  for (const [sid, list] of bySession) appendLocalEvents(sid, list);
}

/** Events after `after` (a db cursor, or a line index locally), at most `limit`. */
export async function readAfter(sessionId: string, after: number, limit: number): Promise<{ events: DomainEvent[]; cursor: number }> {
  if (hasDb()) {
    const rows = await readEvents(sessionId, after, limit);
    return { events: rows.map((r) => r.event), cursor: rows.at(-1)?.cursor ?? after };
  }
  const all = loadLocalEvents(sessionId);
  const events = all.slice(after, after + limit);
  return { events, cursor: after + events.length };
}
```

In `apps/web/app/api/events/route.ts`, replace the `try { if (hasDb()) … }` block with `await appendAny(events);` (inside the same try/catch).

- [ ] **Step 2: Write the failing tests**

```ts
// apps/web/app/api/events/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signSessionToken } from '@/lib/host-auth';

vi.mock('server-only', () => ({}));
const appended: unknown[] = [];
vi.mock('@/lib/event-store', () => ({
  appendAny: async (e: unknown[]) => void appended.push(...e),
  readAfter: async () => ({ events: [{ eventId: 'a:1' }], cursor: 7 }),
}));

const SECRET = 'signing-secret-0123456789';
const ev = (sessionId: string, type = 'utterance.final') => ({ eventId: `${sessionId}:x${Math.random()}`, sessionId, type, actor: 'system', mediaMs: 0, wallTs: new Date().toISOString(), payload: {} });
const req = (token: string | null, events: unknown[]) =>
  new Request('http://x/api/events', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ events }) });

describe('/api/events session tier', () => {
  beforeEach(() => {
    process.env.HOST_SIGNING_SECRET = SECRET;
    appended.length = 0;
  });
  it('accepts pipeline events for its own session', async () => {
    const { POST } = await import('./route');
    const t = await signSessionToken(SECRET, 'sess-a', Date.now());
    const res = await POST(req(t, [ev('sess-a'), ev('sess-a', 'insight.proposed')]));
    expect(res.status).toBe(200);
    expect(appended).toHaveLength(2);
  });
  it('refuses another session with 403 and writes nothing', async () => {
    const { POST } = await import('./route');
    const t = await signSessionToken(SECRET, 'sess-a', Date.now());
    expect((await POST(req(t, [ev('sess-a'), ev('sess-b')]))).status).toBe(403);
    expect(appended).toHaveLength(0);
  });
  it('refuses session.started (the server writes it)', async () => {
    const { POST } = await import('./route');
    const t = await signSessionToken(SECRET, 'sess-a', Date.now());
    expect((await POST(req(t, [ev('sess-a', 'session.started')]))).status).toBe(403);
  });
  it('still refuses anonymous writes', async () => {
    const { POST } = await import('./route');
    expect((await POST(req(null, [ev('sess-a')]))).status).toBe(401);
  });
  it('GET needs the token for that session', async () => {
    const { GET } = await import('./route');
    const t = await signSessionToken(SECRET, 'sess-a', Date.now());
    expect((await GET(new Request('http://x/api/events?sessionId=sess-a&after=0'))).status).toBe(401);
    expect((await GET(new Request('http://x/api/events?sessionId=sess-b&after=0', { headers: { authorization: `Bearer ${t}` } }))).status).toBe(403);
    const ok = await GET(new Request('http://x/api/events?sessionId=sess-a&after=0', { headers: { authorization: `Bearer ${t}` } }));
    expect(await ok.json()).toEqual({ events: [{ eventId: 'a:1' }], cursor: 7 });
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `pnpm --filter @adl/web test -- api/events`
Expected: FAIL. POST returns 401 for the token cases, and `GET` is not exported.

- [ ] **Step 4: Implement the tier and the GET in `apps/web/app/api/events/route.ts`**

Add to the imports: `import { verifySessionToken } from '@/lib/host-auth';` and `import { appendAny, readAfter } from '@/lib/event-store';`. Update the doc comment to list the fourth tier. Then change the start of `POST`:

```ts
async function sessionFromBearer(req: Request): Promise<string | null> {
  const secret = process.env.HOST_SIGNING_SECRET;
  const auth = req.headers.get('authorization');
  if (!secret || !auth?.startsWith('Bearer v1.')) return null;
  return verifySessionToken(secret, auth.slice('Bearer '.length), Date.now());
}

export async function POST(req: Request) {
  const worker = bearer(req, process.env.ROLE_LINK_SECRET);
  const capture = bearer(req, process.env.CAPTURE_TOKEN);
  const operator = bearer(req, process.env.OPERATOR_KEY);
  const hostSession = worker || capture || operator ? null : await sessionFromBearer(req);
  if (!worker && !capture && !operator && !hostSession) return Response.json({ error: 'operator key required' }, { status: 401 });
  // … body parsing unchanged …
  for (const e of events) {
    const bad = checkEnvelope(e);
    if (bad) return Response.json({ error: bad }, { status: 400 });
    if (!isValidSessionId(e.sessionId)) return Response.json({ error: 'invalid sessionId' }, { status: 400 });
    if (worker) continue;
    if (hostSession) {
      if (e.sessionId !== hostSession) return Response.json({ error: 'this token is for another session' }, { status: 403 });
      if (e.type === 'session.started') return Response.json({ error: 'session.started is written by the server' }, { status: 403 });
      continue;
    }
    // … capture/operator checks unchanged …
  }
  try {
    await appendAny(events);
  } catch (err) {
    console.error('[api/events] append failed', err);
    return Response.json({ error: 'append failed' }, { status: 500 });
  }
  return Response.json({ accepted: events.length });
}

/** Resume for a host tab (raw events: token only, never public). */
export async function GET(req: Request) {
  const sid = await sessionFromBearer(req);
  if (!sid) return Response.json({ error: 'session token required' }, { status: 401 });
  const url = new URL(req.url);
  const sessionId = url.searchParams.get('sessionId') ?? '';
  if (sessionId !== sid) return Response.json({ error: 'this token is for another session' }, { status: 403 });
  const after = Math.max(0, Number(url.searchParams.get('after') ?? 0) || 0);
  return Response.json(await readAfter(sessionId, after, 5000));
}
```

Note: the whole batch is checked before anything is appended, so a mixed batch writes nothing. The 403 test checks this.

- [ ] **Step 5: Write the session route, and a test for it**

```ts
// apps/web/app/api/host/session/route.ts
/** Create a host session (spec §3) or re-issue its token. Cookie required. */
import { cookies } from 'next/headers';
import type { DomainEvent } from '@adl/core';
import { HOST_COOKIE, signSessionToken, verifyHostCookie } from '@/lib/host-auth';
import { hostEnv } from '@/lib/host-env';
import { appendAny } from '@/lib/event-store';
import { isValidSessionId, newSessionId } from '@/lib/session-id';

export const dynamic = 'force-dynamic';
type Started = Extract<DomainEvent, { type: 'session.started' }>;

export async function POST(req: Request) {
  const env = hostEnv();
  if (!env) return Response.json({ error: 'Hosting is not set up on this server yet.' }, { status: 503 });
  const jar = await cookies();
  if (!(await verifyHostCookie(env.secret, jar.get(HOST_COOKIE)?.value, Date.now()))) return Response.json({ error: 'Sign in as a host first.' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as (Partial<Started['payload']> & { sessionId?: string }) | null;
  if (!body) return Response.json({ error: 'body must be JSON' }, { status: 400 });

  if (body.sessionId) {
    if (!isValidSessionId(body.sessionId)) return Response.json({ error: 'invalid sessionId' }, { status: 400 });
    return Response.json({ sessionId: body.sessionId, token: await signSessionToken(env.secret, body.sessionId, Date.now()) });
  }
  const title = body.title?.trim();
  if (!title || !body.format || !Array.isArray(body.participants) || body.participants.length === 0) return Response.json({ error: 'title, format and participants are required' }, { status: 400 });
  const sessionId = newSessionId(title);
  const started: Started = {
    eventId: `${sessionId}:start`,
    sessionId,
    type: 'session.started',
    actor: 'operator',
    mediaMs: 0,
    wallTs: new Date().toISOString(),
    payload: { title, format: body.format, participants: body.participants, ...(body.seats ? { seats: body.seats } : {}), source: body.source ?? { kind: 'live' } },
  };
  await appendAny([started]);
  return Response.json({ sessionId, token: await signSessionToken(env.secret, sessionId, Date.now()) });
}
```

```ts
// apps/web/app/api/host/session/route.test.ts
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
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `pnpm --filter @adl/web test`
Expected: PASS, all suites.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/event-store.ts apps/web/app/api/events apps/web/app/api/host/session
git commit -m "web: host sessions get a per-session write token; token-guarded event resume"
```

---

### Task 4: The public list shows finished debates only; `/new` goes to the host flow

**Files:**
- Modify:
  - `apps/web/lib/sessions.ts` (add `publicSessions`)
  - `apps/web/lib/sessions.test.ts` (create)
  - `apps/web/app/page.tsx:76-86`
  - `apps/web/app/new/page.tsx`

**Interfaces:**
- Produces: `publicSessions(all: SessionSummary[]): SessionSummary[]`, which keeps `s.ended === true` only.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/sessions.test.ts
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { publicSessions, type SessionSummary } from './sessions';

const s = (id: string, ended: boolean): SessionSummary => ({ id, title: id, format: 'anti-debate', source: null, participants: [], startedAt: '2026-09-29T00:00:00Z', ended });

describe('publicSessions', () => {
  it('lists finished debates only', () => {
    expect(publicSessions([s('done', true), s('live-now', false)]).map((x) => x.id)).toEqual(['done']);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.** Run `pnpm --filter @adl/web test -- sessions`. Expected: FAIL, "publicSessions is not exported".

- [ ] **Step 3: Implement.** In `apps/web/lib/sessions.ts`, add:

```ts
/** The public home page lists finished debates only; a live session is reachable by its link (spec §3). */
export function publicSessions(all: SessionSummary[]): SessionSummary[] {
  return all.filter((s) => s.ended);
}
```

In `apps/web/app/page.tsx`, change `sessions = await listSessions();` to `sessions = publicSessions(await listSessions());` and import `publicSessions`. `active` becomes empty by construction. Delete the "Live" section's rendering branch only if it now references nothing. Replace any "Start a session" link on the home page with a small `Host a session` link to `/host`.

Replace `apps/web/app/new/page.tsx` with:

```tsx
import { redirect } from 'next/navigation';

export default function NewSessionPage() {
  redirect('/host/new');
}
```

Leave `NewSessionForm.tsx` in place: Task 12 reuses its participant-row UI.

- [ ] **Step 4: Run the tests and typecheck.** Run `pnpm --filter @adl/web test && pnpm --filter @adl/web typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/sessions.ts apps/web/lib/sessions.test.ts apps/web/app/page.tsx apps/web/app/new/page.tsx
git commit -m "web: public home lists finished debates only; /new moves to /host/new"
```

---

### Task 5: `@adl/llm` transport seam, with a browser transport

**Files:**
- Create:
  - `packages/llm/src/core.ts`
  - `packages/llm/src/node.ts` (moved code)
  - `packages/llm/src/browser.ts`
  - `packages/llm/src/index.browser.ts`
  - `packages/llm/src/browser.test.ts`
  - `packages/llm/src/core.test.ts`
- Modify:
  - `packages/llm/src/client.ts` (deleted; its content is split into core.ts and node.ts)
  - `packages/llm/src/index.ts`
  - `packages/llm/package.json` (conditional exports)

**Interfaces:**
- Produces, unchanged for every caller:
  - `callStructured<S>(call: StructuredCall<S>): Promise<LlmResult<z.infer<S>>>`
  - `LlmCallLog`, `LlmResult`, `StructuredCall`, `setLlmLogSink`
- Produces, new:
  - `type Caller = (call: StructuredCall<z.ZodType>) => Promise<LlmResult<unknown>>`
  - `setCaller(c: Caller): void`
  - `browserCaller(apiKey: string, opts?: { fetch?: typeof fetch }): Caller`
  - `Provider` gains `'browser'`
  - `nodeCaller: Caller` (the old `callStructured` body)
- Resolution: `@adl/llm` resolves to `index.browser.ts` under the `browser` export condition (client bundles), and to `index.ts` otherwise. The Node entry installs `nodeCaller` by default. The browser entry has no default caller: calling before `setCaller` returns `{ok:false, reason:'provider_error', detail:'No Anthropic key is set on this device.'}`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/llm/src/core.test.ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { callStructured, setCaller } from './core';

describe('callStructured seam', () => {
  it('delegates to the installed caller and validates with the schema', async () => {
    setCaller(async (c) => ({ ok: true, data: { n: 1 }, log: { pass: c.pass } as never }));
    const r = await callStructured({ pass: 'L1_extract', promptVersion: 'v', instructions: 'i', input: 'x', schema: z.object({ n: z.number() }) });
    expect(r).toMatchObject({ ok: true, data: { n: 1 } });
  });
});
```

```ts
// packages/llm/src/browser.test.ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { browserCaller } from './browser';

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const msg = (text: string) => ({
  id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn', stop_sequence: null,
  content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
});

describe('browserCaller', () => {
  it('calls Anthropic directly with the browser header and the pass model', async () => {
    const { f, calls } = fakeFetch(200, msg('{"n":2}'));
    const r = await browserCaller('sk-ant-test', { fetch: f })({ pass: 'L2_critic', promptVersion: 'v', instructions: 'sys', input: 'in', schema: z.object({ n: z.number() }) });
    expect(r).toMatchObject({ ok: true, data: { n: 2 }, log: { provider: 'browser', model: 'claude-sonnet-5-5' } });
    expect(calls[0]!.url).toContain('api.anthropic.com/v1/messages');
    const h = new Headers(calls[0]!.init.headers);
    expect(h.get('anthropic-dangerous-direct-browser-access')).toBe('true');
    expect(h.get('x-api-key')).toBe('sk-ant-test');
  });
  it('maps a 401 to provider_error without echoing the key', async () => {
    const { f } = fakeFetch(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
    const r = await browserCaller('sk-ant-secret', { fetch: f })({ pass: 'L1_extract', promptVersion: 'v', instructions: 's', input: 'i', schema: z.object({}) });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain('sk-ant-secret');
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @adl/llm test`. Expected: FAIL, "Cannot find module './core'".

- [ ] **Step 3: Split the module.**

`packages/llm/src/core.ts` holds the shared types plus the seam. Move the `Provider`, `LlmCallLog`, `LlmResult`, `StructuredCall`, `LogSink` and `setLlmLogSink` declarations here verbatim from `client.ts`. Change `Provider` to `'subscription' | 'api' | 'cache' | 'browser'`, then add:

```ts
export type Caller = (call: StructuredCall<z.ZodType>) => Promise<LlmResult<unknown>>;
let caller: Caller | null = null;
export function setCaller(c: Caller): void {
  caller = c;
}
export async function emitLog(l: LlmCallLog): Promise<void> {
  await sink(l);
}
export async function callStructured<S extends z.ZodType>(call: StructuredCall<S>): Promise<LlmResult<z.infer<S>>> {
  if (!caller) {
    const log = { pass: call.pass, promptVersion: call.promptVersion, model: '', effort: '', provider: 'browser', cached: false, inputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0, latencyMs: 0, stopReason: null, billedUsd: 0 } as LlmCallLog;
    return { ok: false, reason: 'provider_error', detail: 'No Anthropic key is set on this device.', log };
  }
  const r = await caller(call as StructuredCall<z.ZodType>);
  if (!r.ok) return r;
  const parsed = call.schema.safeParse(r.data);
  return parsed.success ? { ok: true, data: parsed.data, log: r.log } : { ok: false, reason: 'parse_error', detail: parsed.error.message, log: r.log };
}
```

`packages/llm/src/node.ts` gets everything else from `client.ts`: cache, ledger, `viaApi`, `viaSubscription` and `provider()`. Rename the old `export async function callStructured` to `export const nodeCaller: Caller = async (call) => { … }`, with the body unchanged except for two edits: `await sink(l)` becomes `await emitLog(l)`, and the imports come from `./core`. Delete `client.ts`.

```ts
// packages/llm/src/index.ts  (Node / server)
import { setCaller } from './core';
import { nodeCaller } from './node';

export * from './models';
export * from './core';
export { apiSpentUsd, nodeCaller, provider } from './node';
setCaller(nodeCaller);
```

```ts
// packages/llm/src/index.browser.ts  (client bundles: no node:* imports)
export * from './models';
export * from './core';
export { browserCaller } from './browser';
```

```json
// packages/llm/package.json  → "exports"
"exports": { ".": { "browser": "./src/index.browser.ts", "default": "./src/index.ts" } }
```

- [ ] **Step 4: Write the browser caller**

```ts
// packages/llm/src/browser.ts
/**
 * Browser transport (spec §7): the host's own key, straight from their tab to
 * api.anthropic.com. Same models, effort, output format and log shape as the API path.
 * The key is never logged or included in an error.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
import { emitLog, type Caller, type LlmCallLog, type StructuredCall } from './core';
import { passConfig, PRICES } from './models';

function cost(model: string, u: { input: number; cacheRead: number; cacheWrite: number; output: number }): number {
  const p = PRICES[model] ?? { in: 5, out: 25, cacheRead: 0.5 };
  return (u.input * p.in + u.cacheWrite * p.in * 1.25 + u.cacheRead * p.cacheRead + u.output * p.out) / 1e6;
}

export function browserCaller(apiKey: string, opts: { fetch?: typeof fetch } = {}): Caller {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 3, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
  return async (call: StructuredCall<z.ZodType>) => {
    const cfg = passConfig(call.pass);
    const started = Date.now();
    const base: LlmCallLog = { pass: call.pass, promptVersion: call.promptVersion, model: cfg.model, effort: cfg.effort, provider: 'browser', cached: false, inputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0, latencyMs: 0, stopReason: null, billedUsd: 0, ...(call.sessionId ? { sessionId: call.sessionId } : {}) };
    try {
      const r = await client.beta.messages
        .stream({
          model: cfg.model,
          max_tokens: cfg.maxTokens,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          thinking: { type: 'adaptive' },
          output_config: { effort: cfg.effort, format: zodOutputFormat(call.schema) },
          system: [{ type: 'text', text: call.instructions, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: call.sessionContext ? `${call.sessionContext}\n\n${call.input}` : call.input }],
        })
        .finalMessage();
      const u = { input: r.usage.input_tokens, cacheRead: r.usage.cache_read_input_tokens ?? 0, cacheWrite: r.usage.cache_creation_input_tokens ?? 0, output: r.usage.output_tokens };
      const log: LlmCallLog = { ...base, model: r.model, inputTokens: u.input, cacheReadTokens: u.cacheRead, cacheCreationTokens: u.cacheWrite, outputTokens: u.output, latencyMs: Date.now() - started, stopReason: r.stop_reason, billedUsd: cost(r.model, u) };
      await emitLog(log);
      if (r.stop_reason === 'refusal') return { ok: false, reason: 'refusal', detail: 'The model declined this input.', log };
      if (r.stop_reason === 'max_tokens') return { ok: false, reason: 'max_tokens', detail: 'Output truncated', log };
      const text = r.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      try {
        return { ok: true, data: JSON.parse(text) as unknown, log };
      } catch (e) {
        return { ok: false, reason: 'parse_error', detail: `Invalid JSON: ${(e as Error).message}`, log };
      }
    } catch (e) {
      const log = { ...base, latencyMs: Date.now() - started };
      await emitLog(log);
      const status = (e as { status?: number }).status;
      const detail = status ? `Anthropic returned ${status}` : 'The browser could not reach Anthropic';
      return { ok: false, reason: 'provider_error', detail, log };
    }
  };
}
```

- [ ] **Step 5: Run the whole repo check** (the worker and pipeline must be unaffected)

Run: `pnpm --filter @adl/llm test && pnpm check`
Expected: PASS. If the Vitest run in `packages/llm` resolves the SDK's `fetch` option differently in this SDK version, check `node_modules/@anthropic-ai/sdk/client.d.ts` for the `fetch` ClientOptions name and match it.

- [ ] **Step 6: Commit**

```bash
git add packages/llm
git commit -m "llm: transport seam; browser transport on the host's own key (node path unchanged)"
```

---

### Task 6: `packages/engine`: the shared SessionEngine

**Files:**
- Create:
  - `packages/engine/package.json`, `tsconfig.json`
  - `packages/engine/src/index.ts`
  - `packages/engine/src/types.ts`
  - `packages/engine/src/engine.test.ts`
- Move: `apps/worker/src/engine.ts` → `packages/engine/src/engine.ts`
- Modify:
  - `apps/worker/src/log.ts` (import `EventLog` from `@adl/engine`)
  - `apps/worker/src/run.ts` (import `SessionEngine` from `@adl/engine`)
  - `apps/worker/package.json`

**Interfaces:**
- Produces:
  - `@adl/engine` exports `SessionEngine`, `EngineOptions`, `EventLog` (the interface is unchanged: `kind: 'db'|'file'|'http'`, `where`, `append`, `read`, `logCall`), and `HttpEventLog` (Task 7).
  - `EngineOptions` gains `onProgress?: (p: { processedMediaMs: number; queued: number; insightRunning: boolean }) => void`, called once per loop tick.

- [ ] **Step 1: Create the package**

```json
// packages/engine/package.json
{
  "name": "@adl/engine",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc -p tsconfig.json", "test": "vitest run" },
  "dependencies": { "@adl/core": "workspace:*", "@adl/llm": "workspace:*", "@adl/pipeline": "workspace:*", "zod": "^4.6.5" }
}
```

Copy `tsconfig.json` from `packages/pipeline/tsconfig.json`.

```ts
// packages/engine/src/types.ts
import type { DomainEvent } from '@adl/core';
import type { LlmCallLog } from '@adl/llm';

export interface EventLog {
  readonly kind: 'db' | 'file' | 'http';
  readonly where: string;
  append(events: DomainEvent[]): Promise<void>;
  /** Events after `cursor`, in append order, and the new cursor. */
  read(cursor: number): Promise<{ cursor: number; events: DomainEvent[] }>;
  logCall(log: LlmCallLog): Promise<void>;
}
```

`git mv apps/worker/src/engine.ts packages/engine/src/engine.ts`. Change its import `from './log'` to `from './types'`. Add `onProgress` to `EngineOptions`, and call `this.opts.onProgress?.({ processedMediaMs: this.processedMediaMs, queued: this.queue.length, insightRunning: Boolean(this.insightRunning) });` right before the `await new Promise((r) => setTimeout(r, this.opts.pollMs));` line in `run()`.

```ts
// packages/engine/src/index.ts
export * from './types';
export * from './engine';
export * from './http-log';
```

(`http-log.ts` arrives in Task 7. Until then, leave that export line out and add it in Task 7.)

In `apps/worker/src/log.ts`: delete the local `EventLog` interface, and add `import type { EventLog } from '@adl/engine'; export type { EventLog };`. In `run.ts`: `import { SessionEngine } from '@adl/engine';`. Add `"@adl/engine": "workspace:*"` to `apps/worker/package.json`, then run `pnpm install`.

- [ ] **Step 2: Write an engine test that runs with no model** (this also proves the browser seam: a fake caller)

```ts
// packages/engine/src/engine.test.ts
import { describe, expect, it } from 'vitest';
import type { DomainEvent } from '@adl/core';
import { setCaller } from '@adl/llm';
import { SessionEngine } from './engine';
import type { EventLog } from './types';

class MemLog implements EventLog {
  readonly kind = 'http' as const;
  readonly where = 'memory';
  events: DomainEvent[] = [];
  async append(e: DomainEvent[]) { for (const x of e) if (!this.events.some((y) => y.eventId === x.eventId)) this.events.push(x); }
  async read(c: number) { return { cursor: this.events.length, events: this.events.slice(c) }; }
  async logCall() {}
}

const sid = 't1';
const w = new Date(0).toISOString();
const utt = (id: string, who: string, startMs: number, text: string): DomainEvent => ({
  eventId: `${sid}:${id}`, sessionId: sid, type: 'utterance.final', actor: 'system', mediaMs: startMs + 2000, wallTs: w,
  payload: { utterance: { id, participantKey: who, startMs, endMs: startMs + 2000, text, words: [], attribution: { confidence: 1, signals: {}, confirmedBy: 'auto' }, overlapsWith: [] } },
});

describe('SessionEngine with an injected caller', () => {
  it('closes turns, calls the passes through the seam, and ends the session', async () => {
    const passes: string[] = [];
    setCaller(async (c) => { passes.push(c.pass); return { ok: false, reason: 'provider_error', detail: 'offline test', log: { pass: c.pass } as never }; });
    const log = new MemLog();
    await log.append([
      { eventId: `${sid}:start`, sessionId: sid, type: 'session.started', actor: 'operator', mediaMs: 0, wallTs: w, payload: { title: 'T', format: 'open', participants: [{ key: 'A', displayName: 'Ann', role: 'debater' }, { key: 'B', displayName: 'Bo', role: 'debater' }] } },
      utt('u1', 'A', 0, 'I think taxes should fall.'),
      utt('u2', 'B', 3000, 'I disagree, they should rise.'),
    ]);
    const engine = new SessionEngine({ sessionId: sid, log, pollMs: 5, silenceMs: 1 });
    engine.finishSource();
    await engine.run();
    expect(log.events.filter((e) => e.type === 'turn.closed')).toHaveLength(2);
    expect(passes).toContain('L1_extract');
    expect(log.events.at(-1)!.type).toBe('session.ended');
  });
});
```

- [ ] **Step 3: Run it.** Run `pnpm install && pnpm --filter @adl/engine test`. Expected: PASS. A failure here means the move broke an import. Fix that; don't change engine behaviour.

- [ ] **Step 4: Run the full check, and a worker smoke run from cache** (costs nothing)

Run: `pnpm check && LLM_PROVIDER=cache pnpm --filter @adl/worker run:session -- --help`
Expected: typecheck and tests pass, and the worker CLI prints its usage (no import errors).

- [ ] **Step 5: Commit**

```bash
git add packages/engine apps/worker pnpm-lock.yaml
git commit -m "engine: SessionEngine moves to @adl/engine, shared by the worker and the host tab"
```

---

### Task 7: `HttpEventLog`, with an outbox that survives reloads

**Files:**
- Create: `packages/engine/src/http-log.ts`, `packages/engine/src/http-log.test.ts`
- Modify: `packages/engine/src/index.ts` (add `export * from './http-log';`)

**Interfaces:**
- Consumes: Task 3 (`POST /api/events` and `GET /api/events` with `Bearer <token>`), Task 6 (`EventLog`).
- Produces:
  - `interface OutboxStore { load(): Promise<DomainEvent[]>; save(pending: DomainEvent[]): Promise<void> }`
  - `class MemoryOutbox implements OutboxStore`
  - `class HttpEventLog implements EventLog`, with:
    - `constructor(opts: { sessionId: string; token: () => Promise<string>; outbox: OutboxStore; baseUrl?: string; fetch?: typeof fetch; flushEveryMs?: number; batch?: number; onCall?: (l: LlmCallLog) => void })`
    - `hydrate(): Promise<void>`, which pulls the server's events after 0 into local memory and re-queues the stored outbox
    - `pending(): number`
    - `flush(): Promise<void>`
    - `close(): Promise<void>`
    - `onStatus?: (s: { pending: number; lastError: string | null }) => void`

Behaviour:
- `append` adds to memory, and to the outbox if the eventId is new. It persists the outbox.
- `read(cursor)` serves from memory.
- A timer flushes every `flushEveryMs` (default 1000 ms), in batches of `batch` (default 50).
- A failed POST keeps the events and retries with backoff (1, 2, 4 … 30 s).
- A 401 calls `token()` again once (re-issued by the cookie route).

- [ ] **Step 1: Write the failing tests**

```ts
// packages/engine/src/http-log.test.ts
import { describe, expect, it } from 'vitest';
import type { DomainEvent } from '@adl/core';
import { HttpEventLog, MemoryOutbox } from './http-log';

const ev = (n: number): DomainEvent => ({ eventId: `s:${n}`, sessionId: 's', type: 'round.ended', actor: 'system', mediaMs: n, wallTs: new Date(0).toISOString(), payload: { roundId: 'r' } });

function server(opts: { failFirst?: number; existing?: DomainEvent[] } = {}) {
  const stored: DomainEvent[] = [...(opts.existing ?? [])];
  let fails = opts.failFirst ?? 0;
  const f = (async (url: string, init?: RequestInit) => {
    if (!init || init.method === 'GET' || !init.method) {
      const after = Number(new URL(url, 'http://x').searchParams.get('after'));
      return Response.json({ events: stored.slice(after), cursor: stored.length });
    }
    if (fails-- > 0) return new Response('down', { status: 503 });
    const { events } = JSON.parse(String(init.body)) as { events: DomainEvent[] };
    for (const e of events) if (!stored.some((x) => x.eventId === e.eventId)) stored.push(e);
    return Response.json({ accepted: events.length });
  }) as unknown as typeof fetch;
  return { stored, f };
}

describe('HttpEventLog', () => {
  it('keeps events through a failing POST and delivers them once', async () => {
    const { stored, f } = server({ failFirst: 1 });
    const log = new HttpEventLog({ sessionId: 's', token: async () => 't', outbox: new MemoryOutbox(), fetch: f, flushEveryMs: 1_000_000 });
    await log.append([ev(1), ev(2)]);
    await log.flush();
    expect(log.pending()).toBe(2);
    await log.flush();
    expect(log.pending()).toBe(0);
    await log.append([ev(2)]);
    await log.flush();
    expect(stored.map((e) => e.eventId)).toEqual(['s:1', 's:2']);
  });
  it('resumes: hydrate loads the server log and re-sends the stored outbox', async () => {
    const outbox = new MemoryOutbox();
    await outbox.save([ev(3)]);
    const { stored, f } = server({ existing: [ev(1), ev(2)] });
    const log = new HttpEventLog({ sessionId: 's', token: async () => 't', outbox, fetch: f, flushEveryMs: 1_000_000 });
    await log.hydrate();
    expect((await log.read(0)).events.map((e) => e.eventId)).toEqual(['s:1', 's:2', 's:3']);
    await log.flush();
    expect(stored).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @adl/engine test -- http-log`. Expected: FAIL, the module is missing.

- [ ] **Step 3: Implement**

```ts
// packages/engine/src/http-log.ts
/**
 * The host tab's event log (spec §7). Local memory is the engine's source of truth;
 * an outbox (persisted by the caller, IndexedDB in the browser) delivers events to
 * /api/events with the session token. Posts are idempotent by eventId, so a retry or a
 * reload never duplicates anything.
 */
import type { DomainEvent } from '@adl/core';
import type { LlmCallLog } from '@adl/llm';
import type { EventLog } from './types';

export interface OutboxStore {
  load(): Promise<DomainEvent[]>;
  save(pending: DomainEvent[]): Promise<void>;
}

export class MemoryOutbox implements OutboxStore {
  private items: DomainEvent[] = [];
  async load() { return [...this.items]; }
  async save(p: DomainEvent[]) { this.items = [...p]; }
}

export interface HttpEventLogOptions {
  sessionId: string;
  token: () => Promise<string>;
  outbox: OutboxStore;
  baseUrl?: string;
  fetch?: typeof fetch;
  flushEveryMs?: number;
  batch?: number;
  onCall?: (l: LlmCallLog) => void;
}

export class HttpEventLog implements EventLog {
  readonly kind = 'http' as const;
  readonly where: string;
  onStatus?: (s: { pending: number; lastError: string | null }) => void;
  private events: DomainEvent[] = [];
  private ids = new Set<string>();
  private queue: DomainEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs = 0;
  private flushing: Promise<void> | null = null;
  private lastError: string | null = null;
  private tokenValue: string | null = null;
  private readonly f: typeof fetch;

  constructor(private readonly o: HttpEventLogOptions) {
    this.where = `${o.baseUrl ?? ''}/api/events`;
    this.f = o.fetch ?? fetch.bind(globalThis);
  }

  pending() { return this.queue.length; }

  private remember(e: DomainEvent): boolean {
    if (this.ids.has(e.eventId)) return false;
    this.ids.add(e.eventId);
    this.events.push(e);
    return true;
  }

  private async auth(refresh = false): Promise<string> {
    if (refresh || !this.tokenValue) this.tokenValue = await this.o.token();
    return this.tokenValue;
  }

  async hydrate(): Promise<void> {
    let after = 0;
    for (;;) {
      const res = await this.f(`${this.o.baseUrl ?? ''}/api/events?sessionId=${encodeURIComponent(this.o.sessionId)}&after=${after}`, { headers: { authorization: `Bearer ${await this.auth()}` } });
      if (!res.ok) throw new Error(`Could not load this session (${res.status})`);
      const { events, cursor } = (await res.json()) as { events: DomainEvent[]; cursor: number };
      for (const e of events) this.remember(e);
      if (events.length < 5000) break;
      after = cursor;
    }
    for (const e of await this.o.outbox.load()) {
      this.remember(e);
      if (!this.queue.some((q) => q.eventId === e.eventId)) this.queue.push(e);
    }
    this.schedule();
  }

  async append(events: DomainEvent[]): Promise<void> {
    const fresh = events.filter((e) => this.remember(e));
    if (!fresh.length) return;
    this.queue.push(...fresh);
    await this.o.outbox.save(this.queue);
    this.schedule();
  }

  async read(cursor: number) {
    return { cursor: this.events.length, events: this.events.slice(cursor) };
  }

  async logCall(l: LlmCallLog) {
    this.o.onCall?.(l);
  }

  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, Math.max(this.o.flushEveryMs ?? 1000, this.backoffMs));
  }

  flush(): Promise<void> {
    this.flushing ??= this.flushOnce().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async flushOnce(): Promise<void> {
    while (this.queue.length) {
      const batch = this.queue.slice(0, this.o.batch ?? 50);
      let res: Response | null = null;
      try {
        const post = async (refresh: boolean) =>
          this.f(this.where, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${await this.auth(refresh)}` }, body: JSON.stringify({ events: batch }) });
        res = await post(false);
        if (res.status === 401) res = await post(true);
      } catch (e) {
        this.lastError = (e as Error).message;
      }
      if (!res?.ok) {
        this.lastError = res ? `The server returned ${res.status}` : (this.lastError ?? 'offline');
        this.backoffMs = Math.min(30_000, Math.max(1000, this.backoffMs * 2));
        this.onStatus?.({ pending: this.queue.length, lastError: this.lastError });
        this.schedule();
        return;
      }
      this.backoffMs = 0;
      this.lastError = null;
      const sent = new Set(batch.map((e) => e.eventId));
      this.queue = this.queue.filter((e) => !sent.has(e.eventId));
      await this.o.outbox.save(this.queue);
      this.onStatus?.({ pending: this.queue.length, lastError: null });
    }
  }

  async close(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.flush();
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass.** Run `pnpm --filter @adl/engine test`. Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "engine: HttpEventLog with a durable outbox, idempotent retry and resume"
```

---

### Task 8: Bring-your-own key: storage, check and the `/host/key` screen

**Files:**
- Create:
  - `apps/web/lib/anthropic-key.ts`, `apps/web/lib/anthropic-key.test.ts`
  - `apps/web/app/host/key/page.tsx`, `apps/web/app/host/key/KeyForm.tsx`
  - `apps/web/components/host/HostBar.tsx`
- Modify: `apps/web/package.json` (add `"@adl/llm": "workspace:*"`, `"@adl/engine": "workspace:*"`, `"@adl/pipeline": "workspace:*"`, `"@anthropic-ai/sdk": "^0.129.0"`)

**Interfaces:**
- Consumes: Task 5 (`passConfig` via `@adl/llm`, which resolves to the browser entry in client code).
- Produces:
  - `getKey(): string | null`, `setKey(k: string): void`, `forgetKey(): void`, `maskKey(k: string): string` (→ `sk-ant-…WXYZ`)
  - `checkKey(key: string, f?: typeof fetch): Promise<{ ok: true } | { ok: false; message: string }>`
  - `keyMessage(status: number | null, body: unknown): string`
  - `<HostBar>`: shows the masked key, a Forget button and a Sign out button.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/lib/anthropic-key.test.ts
import { describe, expect, it } from 'vitest';
import { checkKey, keyMessage, maskKey } from './anthropic-key';

const resp = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('keyMessage', () => {
  it('names each failure plainly', () => {
    expect(keyMessage(401, {})).toBe("That key wasn't accepted. Copy it again from console.anthropic.com → API keys.");
    expect(keyMessage(400, { error: { message: 'Your credit balance is too low to access the Anthropic API.' } })).toBe('The account has no credit yet. Add credits under Billing, then check again.');
    expect(keyMessage(429, {})).toBe('Anthropic is rate-limiting this key. New accounts start with low limits; wait a minute and check again.');
    expect(keyMessage(null, null)).toBe("The browser couldn't reach Anthropic. Check the internet connection and try again.");
  });
});

describe('checkKey', () => {
  it('passes on a 200', async () => {
    expect(await checkKey('sk-ant-x', resp(200, { content: [], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'max_tokens', model: 'claude-sonnet-5-5', role: 'assistant', type: 'message', id: 'm' }))).toEqual({ ok: true });
  });
  it('treats a network failure as unreachable, not as a bad key', async () => {
    const offline = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    const r = await checkKey('sk-ant-x', offline);
    expect(r).toEqual({ ok: false, message: "The browser couldn't reach Anthropic. Check the internet connection and try again." });
  });
  it('rejects text that is not an Anthropic key before any request', async () => {
    expect(await checkKey('hello', resp(200, {}))).toEqual({ ok: false, message: 'Anthropic keys start with sk-ant-. Check that the whole key was pasted.' });
  });
});

describe('maskKey', () => {
  it('shows only the last four characters', () => expect(maskKey('sk-ant-api03-abcdefWXYZ')).toBe('sk-ant-…WXYZ'));
});
```

- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @adl/web test -- anthropic-key`. Expected: FAIL, the module is missing.

- [ ] **Step 3: Implement**

```ts
// apps/web/lib/anthropic-key.ts
/**
 * The host's Anthropic key (spec §4). Stored only in this browser; sent only to
 * api.anthropic.com. Never included in a request to our server or in a log.
 */
import Anthropic from '@anthropic-ai/sdk';
import { passConfig } from '@adl/llm';

const STORAGE = 'adl.anthropicKey';
const UNREACHABLE = "The browser couldn't reach Anthropic. Check the internet connection and try again.";

export function getKey(): string | null {
  try { return window.localStorage.getItem(STORAGE); } catch { return null; }
}
export function setKey(k: string): void {
  try { window.localStorage.setItem(STORAGE, k.trim()); } catch { /* private mode: key lives for this page only */ }
}
export function forgetKey(): void {
  try { window.localStorage.removeItem(STORAGE); } catch { /* nothing stored */ }
}
export function maskKey(k: string): string {
  return `sk-ant-…${k.slice(-4)}`;
}

export function keyMessage(status: number | null, body: unknown): string {
  const text = JSON.stringify(body ?? '').toLowerCase();
  if (status === null) return UNREACHABLE;
  if (status === 401 || status === 403) return "That key wasn't accepted. Copy it again from console.anthropic.com → API keys.";
  if (status === 400 && text.includes('credit')) return 'The account has no credit yet. Add credits under Billing, then check again.';
  if (status === 429) return 'Anthropic is rate-limiting this key. New accounts start with low limits; wait a minute and check again.';
  if (status >= 500) return 'Anthropic is having trouble right now. Try again in a few minutes.';
  return `Anthropic refused the check (${status}).`;
}

/** One 1-token request to the default model: proves the key, the credit and browser access. */
export async function checkKey(key: string, f?: typeof fetch): Promise<{ ok: true } | { ok: false; message: string }> {
  const k = key.trim();
  if (!k.startsWith('sk-ant-')) return { ok: false, message: 'Anthropic keys start with sk-ant-. Check that the whole key was pasted.' };
  const client = new Anthropic({ apiKey: k, dangerouslyAllowBrowser: true, maxRetries: 0, ...(f ? { fetch: f } : {}) });
  try {
    await client.messages.create({ model: passConfig('L1_extract').model, max_tokens: 1, messages: [{ role: 'user', content: 'ok' }] });
    return { ok: true };
  } catch (e) {
    const err = e as { status?: number; error?: unknown };
    return { ok: false, message: keyMessage(typeof err.status === 'number' ? err.status : null, err.error) };
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass.** Run `pnpm --filter @adl/web test -- anthropic-key`. Expected: PASS (6 tests).

- [ ] **Step 5: Build the key screen** (the copy is final; keep it)

```tsx
// apps/web/app/host/key/page.tsx
import type { Metadata } from 'next';
import { KeyForm } from './KeyForm';

export const metadata: Metadata = { title: 'Your Anthropic key · Anti-Debate Live' };

export default function KeyPage() {
  return (
    <main className="min-h-dvh bg-field">
      <div className="mx-auto max-w-2xl px-6 pb-20 pt-16">
        <h1 className="text-[30px] leading-tight text-ink">Connect your Anthropic key</h1>
        <p className="mt-3 text-[15px] text-ink-2">The analysis runs on Claude and is paid for by your own Anthropic account. Your key stays in this browser and goes only to Anthropic.</p>
        <ol className="mt-8 list-decimal space-y-4 pl-5 text-[15px] text-ink">
          <li>Create an account at <a className="underline" href="https://console.anthropic.com" target="_blank" rel="noreferrer">console.anthropic.com</a>. Do this a few days before your event: new accounts can start with lower limits.</li>
          <li>Open <strong>Billing</strong> and buy credits. $25 is a comfortable start: a 90-minute debate used about $12–15 in our measurements (2026-09-28).</li>
          <li>Open <strong>API keys</strong>, choose <strong>Create key</strong>, and name it “antidebate”. Optional: create it in its own workspace and set a monthly spend limit there.</li>
          <li>Copy the key (it starts with <code>sk-ant-</code>) and paste it below.</li>
        </ol>
        <div className="mt-10">
          <KeyForm />
        </div>
        <p className="mt-8 text-sm text-ink-3">Anyone who uses this browser profile can run sessions on this key. On a shared computer, choose Forget key when you finish.</p>
      </div>
    </main>
  );
}
```

```tsx
// apps/web/app/host/key/KeyForm.tsx
'use client';

import { useState } from 'react';
import { checkKey, setKey } from '@/lib/anthropic-key';

export function KeyForm() {
  const [value, setValue] = useState('');
  const [state, setState] = useState<{ kind: 'idle' | 'checking' | 'ok' } | { kind: 'error'; message: string }>({ kind: 'idle' });
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setState({ kind: 'checking' });
        const r = await checkKey(value);
        if (!r.ok) return setState({ kind: 'error', message: r.message });
        setKey(value);
        setState({ kind: 'ok' });
        const next = new URL(window.location.href).searchParams.get('next');
        window.location.assign(next && next.startsWith('/host') ? next : '/host');
      }}
    >
      <label className="block text-sm text-ink-2" htmlFor="key">Anthropic API key</label>
      <input id="key" type="password" autoComplete="off" spellCheck={false} required value={value} onChange={(e) => setValue(e.target.value)} placeholder="sk-ant-…"
        className="min-h-11 w-full rounded-[3px] border border-border bg-surface px-3 py-2 font-mono text-[15px] focus:border-focus" />
      {state.kind === 'error' && <p role="alert" className="text-sm text-danger">{state.message}</p>}
      {state.kind === 'ok' && <p className="text-sm text-ink-2">Key works. Taking you to your sessions.</p>}
      <button type="submit" disabled={state.kind === 'checking'} className="min-h-11 rounded border border-border-2 px-4 text-[15px] hover:bg-field-deep disabled:opacity-50">
        {state.kind === 'checking' ? 'Checking with Anthropic…' : 'Check and save'}
      </button>
    </form>
  );
}
```

```tsx
// apps/web/components/host/HostBar.tsx
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { forgetKey, getKey, maskKey } from '@/lib/anthropic-key';

/** Top bar for every /host page: who pays (masked key) and how to leave. */
export function HostBar({ children }: { children?: React.ReactNode }) {
  const [key, setKeyState] = useState<string | null>(null);
  useEffect(() => setKeyState(getKey()), []);
  return (
    <header className="flex h-14 items-center gap-5 border-b border-border px-6 text-[14px]">
      <Link href="/host" className="label-caps !text-[13px] !tracking-[0.24em] text-ink">Anti-Debate · Host</Link>
      <div className="flex-1">{children}</div>
      {key ? (
        <span className="text-ink-3">
          Key {maskKey(key)} ·{' '}
          <button className="underline" onClick={() => { forgetKey(); window.location.assign('/host/key'); }}>Forget key</button>
        </span>
      ) : (
        <Link className="underline" href="/host/key">Add your key</Link>
      )}
      <button className="text-ink-3 underline" onClick={async () => { await fetch('/api/host/logout', { method: 'POST' }); window.location.assign('/'); }}>Sign out</button>
    </header>
  );
}
```

- [ ] **Step 6: Check by hand, with no real key.** Run `pnpm dev`, sign in at `/host/login`, open `/host/key`, and paste `hello`. Expected: the "start with sk-ant-" message. With the network tab open, paste `sk-ant-fake`. Expected: exactly one request, to `api.anthropic.com`, and "That key wasn't accepted". No request carries the key to `localhost`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/anthropic-key.ts apps/web/lib/anthropic-key.test.ts apps/web/app/host/key apps/web/components/host apps/web/package.json pnpm-lock.yaml
git commit -m "web: bring-your-own Anthropic key with step-by-step setup and a live check"
```

---

### Task 9: Decode audio, and plan ASR chunks

**Files:**
- Create:
  - `apps/web/lib/audio/decode.ts`
  - `apps/web/lib/asr/chunks.ts`, `apps/web/lib/asr/chunks.test.ts`

**Interfaces:**
- Produces:
  - `decodeToChannels(file: Blob): Promise<{ channels: Float32Array[]; durationMs: number }>`: 16 kHz, one array per source channel (at most 2), plus `mono`.
  - `type Word = { text: string; startMs: number; endMs: number; confidence?: number }`
  - `planChunks(totalMs: number, windowMs?: number, overlapMs?: number): { index: number; startMs: number; endMs: number }[]`, with defaults of 60 000 and 4 000
  - `mergeChunkWords(chunks: { startMs: number; endMs: number; words: Word[] }[], overlapMs?: number): Word[]`: keeps each word from the chunk where it lies furthest from an edge, so there are no duplicates at the seams

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/lib/asr/chunks.test.ts
import { describe, expect, it } from 'vitest';
import { mergeChunkWords, planChunks } from './chunks';

describe('planChunks', () => {
  it('covers the whole file with overlapping 60 s windows', () => {
    const c = planChunks(130_000);
    expect(c.map((x) => [x.startMs, x.endMs])).toEqual([[0, 60_000], [56_000, 116_000], [112_000, 130_000]]);
  });
  it('handles a file shorter than one window', () => expect(planChunks(5_000)).toEqual([{ index: 0, startMs: 0, endMs: 5_000 }]));
});

describe('mergeChunkWords', () => {
  it('keeps one copy of each word in the overlap', () => {
    const a = { startMs: 0, endMs: 60_000, words: [{ text: 'one', startMs: 55_000, endMs: 55_400 }, { text: 'two', startMs: 58_500, endMs: 59_000 }] };
    const b = { startMs: 56_000, endMs: 116_000, words: [{ text: 'two', startMs: 58_520, endMs: 59_010 }, { text: 'three', startMs: 60_500, endMs: 61_000 }] };
    expect(mergeChunkWords([a, b]).map((w) => w.text)).toEqual(['one', 'two', 'three']);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.** Run `pnpm --filter @adl/web test -- chunks`. Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// apps/web/lib/asr/chunks.ts
export type Word = { text: string; startMs: number; endMs: number; confidence?: number };

export function planChunks(totalMs: number, windowMs = 60_000, overlapMs = 4_000) {
  const out: { index: number; startMs: number; endMs: number }[] = [];
  for (let start = 0, i = 0; start < totalMs; start += windowMs - overlapMs, i++) {
    out.push({ index: i, startMs: start, endMs: Math.min(totalMs, start + windowMs) });
    if (start + windowMs >= totalMs) break;
  }
  return out;
}

/** In an overlap, each chunk owns the half nearest its own centre; a word goes to the chunk that owns its midpoint. */
export function mergeChunkWords(chunks: { startMs: number; endMs: number; words: Word[] }[]): Word[] {
  const sorted = [...chunks].sort((a, b) => a.startMs - b.startMs);
  const out: Word[] = [];
  sorted.forEach((c, i) => {
    const prev = sorted[i - 1];
    const next = sorted[i + 1];
    const from = prev ? (c.startMs + prev.endMs) / 2 : -Infinity;
    const to = next ? (next.startMs + c.endMs) / 2 : Infinity;
    for (const w of c.words) {
      const mid = (w.startMs + w.endMs) / 2;
      if (mid >= from && mid < to) out.push(w);
    }
  });
  return out;
}
```

```ts
// apps/web/lib/audio/decode.ts
/** Any browser-decodable file → 16 kHz Float32 per channel (at most 2) and a mono mix. */
export async function decodeToChannels(file: Blob): Promise<{ channels: Float32Array[]; mono: Float32Array; durationMs: number }> {
  const bytes = await file.arrayBuffer();
  const probe = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await probe.decodeAudioData(bytes);
  } catch {
    throw new Error('This browser could not read that file. Try an .mp4, .m4a, .mp3 or .wav export.');
  } finally {
    void probe.close();
  }
  const n = Math.min(2, decoded.numberOfChannels);
  const frames = Math.ceil(decoded.duration * 16_000);
  const off = new OfflineAudioContext(n, frames, 16_000);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const r = await off.startRendering();
  const channels = Array.from({ length: n }, (_, i) => r.getChannelData(i).slice());
  const mono = new Float32Array(frames);
  for (const ch of channels) for (let i = 0; i < frames; i++) mono[i]! += ch[i]! / n;
  return { channels, mono, durationMs: Math.round(decoded.duration * 1000) };
}
```

- [ ] **Step 4: Run the tests and confirm they pass.** Run `pnpm --filter @adl/web test -- chunks`. Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/audio apps/web/lib/asr/chunks.ts apps/web/lib/asr/chunks.test.ts
git commit -m "web: browser audio decode and overlap-safe ASR chunking"
```

---

### Task 10: Parakeet ASR in a Web Worker, and the "Prepare this laptop" page

**Files:**
- Create:
  - `apps/web/lib/asr/asr.worker.ts`
  - `apps/web/lib/asr/client.ts`
  - `apps/web/app/host/prepare/page.tsx`, `apps/web/app/host/prepare/Prepare.tsx`
- Modify: `apps/web/package.json` (add `parakeet.js@1.4.4`)

**Interfaces:**
- Consumes: Task 9 (`Word`).
- Produces:
  - `class AsrClient`, with:
    - `static load(onProgress?: (p: { phase: 'download' | 'compile'; fraction: number }) => void): Promise<AsrClient>`
    - `transcribe(pcm: Float32Array, offsetMs: number): Promise<Word[]>`
    - `backend: 'webgpu' | 'wasm'`
    - `benchmark(): Promise<{ realtimeFactor: number }>`
  - `readiness(): Promise<{ browserOk: boolean; webgpu: boolean; modelCached: boolean; persisted: boolean }>`
  - `localStorage['adl.prepared'] = '<ISO date>'` once everything passes

- [ ] **Step 1: Install and read the API.** Run `pnpm --filter @adl/web add parakeet.js@1.4.4`, then read `apps/web/node_modules/parakeet.js/README.md` §Loading models and `types/index.d.ts` to confirm:
  - `fromHub(key, {backend, encoderQuant, decoderQuant, progress?})`
  - `transcribe(pcm, 16000, {returnTimestamps:true, returnConfidences:true, timeOffset})`
  - word fields `text, start_time, end_time, confidence` (seconds)

  If the progress callback option has a different name in `types/index.d.ts`, use that name in Step 2.

- [ ] **Step 2: Write the worker**

```ts
// apps/web/lib/asr/asr.worker.ts
/// <reference lib="webworker" />
import { fromHub } from 'parakeet.js';

type Req = { id: number; kind: 'load' } | { id: number; kind: 'transcribe'; pcm: Float32Array; offsetMs: number };
let model: Awaited<ReturnType<typeof fromHub>> | null = null;
let backend: 'webgpu' | 'wasm' = 'wasm';

self.onmessage = async (e: MessageEvent<Req>) => {
  const m = e.data;
  try {
    if (m.kind === 'load') {
      const hasGpu = 'gpu' in navigator && Boolean(await (navigator as unknown as { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter());
      backend = hasGpu ? 'webgpu' : 'wasm';
      model = await fromHub('parakeet-tdt-0.6b-v3', {
        backend,
        encoderQuant: hasGpu ? 'fp32' : 'int8',
        decoderQuant: 'int8',
        progress: (p: { loaded: number; total: number }) => self.postMessage({ id: m.id, progress: { phase: 'download', fraction: p.total ? p.loaded / p.total : 0 } }),
      });
      self.postMessage({ id: m.id, ok: true, backend });
      return;
    }
    if (!model) throw new Error('model not loaded');
    const r = await model.transcribe(m.pcm, 16000, { returnTimestamps: true, returnConfidences: true, timeOffset: m.offsetMs / 1000 });
    const words = r.words.map((w) => ({ text: w.text, startMs: Math.round(w.start_time * 1000), endMs: Math.round(w.end_time * 1000), ...(w.confidence !== undefined ? { confidence: w.confidence } : {}) }));
    self.postMessage({ id: m.id, ok: true, words });
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, error: (err as Error).message });
  }
};
```

```ts
// apps/web/lib/asr/client.ts
import type { Word } from './chunks';

type Progress = { phase: 'download' | 'compile'; fraction: number };

export class AsrClient {
  private seq = 0;
  private waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; progress?: (p: Progress) => void }>();
  backend: 'webgpu' | 'wasm' = 'wasm';
  private constructor(private readonly worker: Worker) {
    worker.onmessage = (e: MessageEvent<{ id: number; ok?: boolean; error?: string; progress?: Progress } & Record<string, unknown>>) => {
      const w = this.waiting.get(e.data.id);
      if (!w) return;
      if (e.data.progress) return w.progress?.(e.data.progress);
      this.waiting.delete(e.data.id);
      if (e.data.ok) w.resolve(e.data);
      else w.reject(new Error(e.data.error ?? 'transcription failed'));
    };
  }
  private send<T>(msg: object, transfer: Transferable[] = [], progress?: (p: Progress) => void): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject, ...(progress ? { progress } : {}) });
      this.worker.postMessage({ id, ...msg }, transfer);
    });
  }
  static async load(onProgress?: (p: Progress) => void): Promise<AsrClient> {
    const c = new AsrClient(new Worker(new URL('./asr.worker.ts', import.meta.url), { type: 'module' }));
    const r = await c.send<{ backend: 'webgpu' | 'wasm' }>({ kind: 'load' }, [], onProgress);
    c.backend = r.backend;
    return c;
  }
  async transcribe(pcm: Float32Array, offsetMs: number): Promise<Word[]> {
    const copy = pcm.slice();
    return (await this.send<{ words: Word[] }>({ kind: 'transcribe', pcm: copy, offsetMs }, [copy.buffer])).words;
  }
  /** 30 s of silence-plus-tone: measures real-time factor on this laptop. */
  async benchmark(): Promise<{ realtimeFactor: number }> {
    const pcm = new Float32Array(16_000 * 30);
    for (let i = 0; i < pcm.length; i++) pcm[i] = 0.05 * Math.sin((2 * Math.PI * 220 * i) / 16_000);
    const t0 = performance.now();
    await this.transcribe(pcm, 0);
    return { realtimeFactor: 30_000 / (performance.now() - t0) };
  }
}

export async function readiness(): Promise<{ browserOk: boolean; webgpu: boolean; persisted: boolean; prepared: string | null }> {
  const ua = navigator.userAgent;
  const browserOk = /Chrome\/(\d+)/.test(ua) && Number(ua.match(/Chrome\/(\d+)/)![1]) >= 120 && !/Mobile/.test(ua);
  const webgpu = 'gpu' in navigator;
  const persisted = (await navigator.storage?.persisted?.()) ?? false;
  let prepared: string | null = null;
  try { prepared = localStorage.getItem('adl.prepared'); } catch { /* ignore */ }
  return { browserOk, webgpu, persisted, prepared };
}
```

- [ ] **Step 3: Build the prepare page.** `Prepare.tsx` is a client component with four rows. Each row shows Ready, Needs attention or In progress, with a sentence and one button.
  1. **Browser:** from `readiness().browserOk`. Otherwise: "Use Google Chrome (or Microsoft Edge) on a laptop."
  2. **Transcription model:** a button "Download (about 700 MB, once)". It calls `navigator.storage.persist()`, then `AsrClient.load(progress)`, with a progress bar. On a failure: "The download stopped. Choose Download again to resume."
  3. **Speed test:** `benchmark()`. It shows "This laptop transcribes about N× faster than real time", with N from the measurement rounded to 1 decimal. Below 2×: "Recordings will take longer than their own length here; live sessions need a faster laptop."
  4. **Speaker separation:** loads the diarization bundle from Task 11 (`DiarizeClient.load()`).

  When all four pass: `localStorage.setItem('adl.prepared', new Date().toISOString())`, then the page shows "This laptop is ready" and a button to `/host`. `page.tsx` renders `<HostBar/>`, the heading "Prepare this laptop", the line "Do this once per laptop, ideally the day before, on good Wi-Fi.", and `<Prepare/>`.

- [ ] **Step 4: Check by hand.** Run `pnpm dev`, open `/host/prepare` in Chrome, and run steps 1–3. Expected: the download progress moves; after a reload, step 2 completes without re-downloading (cached); step 3 prints a factor. Record the factor and backend in `evals/results.md` under "Browser ASR, Benjamin's laptop".

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/asr apps/web/app/host/prepare apps/web/package.json pnpm-lock.yaml evals/results.md
git commit -m "web: in-browser Parakeet transcription worker and the Prepare this laptop page"
```

---

### Task 11: Speaker separation for single-file recordings, and naming the voices

**Files:**
- Create:
  - `apps/web/scripts/fetch-sherpa.mjs`
  - `apps/web/lib/diarize/diarize.worker.ts`, `apps/web/lib/diarize/client.ts`
  - `apps/web/lib/recording/utterances.ts`, `apps/web/lib/recording/utterances.test.ts`
- Modify:
  - `apps/web/package.json` (`"prebuild": "node scripts/fetch-sherpa.mjs"`, `"predev": "node scripts/fetch-sherpa.mjs"`)
  - `.gitignore` (`apps/web/public/sherpa/`)
  - `.vercelignore` (make sure `apps/web/public/sherpa/` is not listed; it's built on Vercel)

**Interfaces:**
- Consumes: Task 9 (`Word`).
- Produces:
  - `DiarizeClient.load(): Promise<DiarizeClient>`
  - `diarize(mono16k: Float32Array, numSpeakers: number | null): Promise<SpeakerSegment[]>`
  - `type SpeakerSegment = { startMs: number; endMs: number; label: string; confidence: number }` (labels are `S0`, `S1`, …)
  - `buildUtterances(opts: { sessionId: string; words: Word[]; segments: SpeakerSegment[]; voiceMap: Record<string, string | null>; mode: 'diarized' | 'tracks'; wallTs: string }): DomainEvent[]`, which emits `utterance.final` for each utterance and `attribution.pending` for held ones
  - `splitIntoUtterances(words: Word[], gapMs?: number): Word[][]` (default gap 800 ms)

Attribution rules (spec §5, recordings):
- Utterances are split at a speaker change and at pauses of 800 ms or more.
- An utterance is **held** (`attribution.pending`, confidence 0.6, participant `UNK` or the best guess) when any of these is true:
  - its words lie within 300 ms of a segment boundary where the label changes;
  - its label is unnamed in `voiceMap` (value `null`);
  - it falls in no segment.
- An utterance inside a named voice gets confidence `min(0.95, segment.confidence)`, with `confirmedBy: 'operator'` (the host named the voice) and `signals: { diarLabel }`.
- Track mode (one file per speaker, Plan 2 reuses this): the owner is the track's participant, confidence 1.0, `signals: { channel }`.

- [ ] **Step 1: Write the fetch script** (the bundle is 58 MB, so it isn't committed; it's pulled at build)

```js
// apps/web/scripts/fetch-sherpa.mjs
// Prebuilt sherpa-onnx browser diarization (pyannote segmentation-3.0 + speaker embedding), Apache-2.0.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const VERSION = 'v1.13.7';
const NAME = `sherpa-onnx-wasm-simd-${VERSION}-speaker-diarization`;
const dest = new URL('../public/sherpa/', import.meta.url).pathname;
if (existsSync(join(dest, 'sherpa-onnx-wasm-main-speaker-diarization.wasm'))) process.exit(0);
mkdirSync(dest, { recursive: true });
const tmp = join(tmpdir(), `${NAME}.tar.bz2`);
execSync(`curl -fsSL -o "${tmp}" https://github.com/k2-fsa/sherpa-onnx/releases/download/${VERSION}/${NAME}.tar.bz2`, { stdio: 'inherit' });
execSync(`tar xjf "${tmp}" -C "${tmpdir()}"`, { stdio: 'inherit' });
for (const f of readdirSync(join(tmpdir(), NAME))) if (/\.(js|wasm|data)$/.test(f) && f !== 'app-speaker-diarization.js') renameSync(join(tmpdir(), NAME, f), join(dest, f));
console.log(`sherpa-onnx ${VERSION} → public/sherpa`);
```

Run: `node apps/web/scripts/fetch-sherpa.mjs && ls apps/web/public/sherpa`
Expected: `sherpa-onnx-speaker-diarization.js`, `sherpa-onnx-wasm-main-speaker-diarization.{js,wasm,data}`.

- [ ] **Step 2: Write the worker** (classic worker: the emscripten bundle expects `importScripts` and a global `Module`)

```js
// apps/web/public/sherpa/diarize-worker.js  (written by this task, committed via a gitignore exception)
/* global importScripts, createOfflineSpeakerDiarization */
let sd = null;
self.Module = {
  locateFile: (p) => `/sherpa/${p}`,
  onRuntimeInitialized: () => {
    sd = createOfflineSpeakerDiarization(self.Module);
    self.postMessage({ ready: true, sampleRate: sd.sampleRate });
  },
};
importScripts('/sherpa/sherpa-onnx-speaker-diarization.js', '/sherpa/sherpa-onnx-wasm-main-speaker-diarization.js');
self.onmessage = (e) => {
  const { id, samples, numSpeakers } = e.data;
  try {
    sd.setConfig({ ...sd.config, clustering: numSpeakers ? { numClusters: numSpeakers, threshold: 0.5 } : { numClusters: -1, threshold: 0.5 } });
    const segs = sd.process(samples);
    self.postMessage({ id, ok: true, segments: segs.map((s) => ({ startMs: Math.round(s.start * 1000), endMs: Math.round(s.end * 1000), label: `S${s.speaker}`, confidence: s.confidence })) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message ? err.message : err) });
  }
};
```

In `.gitignore`, use `apps/web/public/sherpa/*` plus `!apps/web/public/sherpa/diarize-worker.js`. The Step 1 script must not delete it. Delete the planned `lib/diarize/diarize.worker.ts`; the worker is this public file.

```ts
// apps/web/lib/diarize/client.ts
export type SpeakerSegment = { startMs: number; endMs: number; label: string; confidence: number };

export class DiarizeClient {
  private seq = 0;
  private waiting = new Map<number, (r: { ok: boolean; segments?: SpeakerSegment[]; error?: string }) => void>();
  private constructor(private readonly worker: Worker) {}
  static load(): Promise<DiarizeClient> {
    const w = new Worker('/sherpa/diarize-worker.js');
    const c = new DiarizeClient(w);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Speaker separation did not load. Reload the page and try again.')), 120_000);
      w.onmessage = (e: MessageEvent<{ ready?: boolean; id?: number } & Record<string, unknown>>) => {
        if (e.data.ready) {
          clearTimeout(t);
          w.onmessage = (m: MessageEvent<{ id: number; ok: boolean; segments?: SpeakerSegment[]; error?: string }>) => {
            c.waiting.get(m.data.id)?.(m.data);
            c.waiting.delete(m.data.id);
          };
          resolve(c);
        }
      };
      w.onerror = (e) => reject(new Error(e.message));
    });
  }
  diarize(mono16k: Float32Array, numSpeakers: number | null): Promise<SpeakerSegment[]> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, (r) => (r.ok ? resolve(r.segments ?? []) : reject(new Error(r.error ?? 'speaker separation failed'))));
      this.worker.postMessage({ id, samples: mono16k, numSpeakers });
    });
  }
}
```

- [ ] **Step 3: Write the failing utterance tests** (pure logic: the part that must never commit a guess)

```ts
// apps/web/lib/recording/utterances.test.ts
import { describe, expect, it } from 'vitest';
import { buildUtterances, splitIntoUtterances } from './utterances';

const w = (text: string, startMs: number) => ({ text, startMs, endMs: startMs + 300 });
const words = [w('Taxes', 0), w('should', 400), w('fall.', 800), w('No,', 5_000), w('rise.', 5_400), w('Question', 9_000)];
const segments = [
  { startMs: 0, endMs: 1_200, label: 'S0', confidence: 0.9 },
  { startMs: 4_900, endMs: 5_800, label: 'S1', confidence: 0.92 },
  { startMs: 8_900, endMs: 9_400, label: 'S2', confidence: 0.8 },
];

describe('splitIntoUtterances', () => {
  it('splits at pauses of 800 ms or more', () => expect(splitIntoUtterances(words).map((u) => u.length)).toEqual([3, 2, 1]));
});

describe('buildUtterances', () => {
  const evs = buildUtterances({ sessionId: 's', words, segments, voiceMap: { S0: 'A', S1: 'B', S2: null }, mode: 'diarized', wallTs: new Date(0).toISOString() });
  const finals = evs.filter((e) => e.type === 'utterance.final').map((e) => (e.type === 'utterance.final' ? e.payload.utterance : null)!);
  it('attributes named voices with the diarizer label as the signal', () => {
    expect(finals[0]).toMatchObject({ participantKey: 'A', text: 'Taxes should fall.', attribution: { confirmedBy: 'operator', signals: { diarLabel: 'S0' } } });
    expect(finals[1]!.participantKey).toBe('B');
  });
  it('holds an unnamed voice as UNK with attribution.pending, never as a debater', () => {
    expect(finals[2]).toMatchObject({ participantKey: 'UNK' });
    expect(finals[2]!.attribution.confidence).toBeLessThan(0.85);
    expect(evs.some((e) => e.type === 'attribution.pending' && e.payload.utteranceId === finals[2]!.id)).toBe(true);
  });
  it('is deterministic: same input, same event ids', () => {
    const again = buildUtterances({ sessionId: 's', words, segments, voiceMap: { S0: 'A', S1: 'B', S2: null }, mode: 'diarized', wallTs: new Date(0).toISOString() });
    expect(again.map((e) => e.eventId)).toEqual(evs.map((e) => e.eventId));
  });
});
```

- [ ] **Step 4: Run them and confirm they fail.** Run `pnpm --filter @adl/web test -- utterances`. Expected: FAIL.

- [ ] **Step 5: Implement**

```ts
// apps/web/lib/recording/utterances.ts
/**
 * Words + speaker segments → utterance events (spec §5, recordings). A guess never
 * becomes a debater's claim: unnamed voices, boundary words and uncovered speech are
 * emitted as UNK or held with attribution.pending (below the 0.85 auto threshold).
 * Event ids derive from media times, so re-running a chunk after a reload is idempotent.
 */
import type { DomainEvent } from '@adl/core';
import type { SpeakerSegment } from '@/lib/diarize/client';
import type { Word } from '@/lib/asr/chunks';

const HOLD = 0.6;
const BOUNDARY_MS = 300;

export function splitIntoUtterances(words: Word[], gapMs = 800): Word[][] {
  const out: Word[][] = [];
  for (const w of words) {
    const cur = out.at(-1);
    if (cur && w.startMs - cur.at(-1)!.endMs < gapMs) cur.push(w);
    else out.push([w]);
  }
  return out;
}

function segmentAt(segs: SpeakerSegment[], ms: number): SpeakerSegment | undefined {
  return segs.find((s) => ms >= s.startMs && ms < s.endMs);
}

function nearChange(segs: SpeakerSegment[], startMs: number, endMs: number, label: string): boolean {
  return segs.some((s) => s.label !== label && (Math.abs(s.startMs - startMs) < BOUNDARY_MS || Math.abs(s.endMs - startMs) < BOUNDARY_MS || Math.abs(s.startMs - endMs) < BOUNDARY_MS));
}

/** Split each pause-delimited run again wherever the speaker label changes. */
function byLabel(run: Word[], segs: SpeakerSegment[]): { label: string | null; words: Word[] }[] {
  const out: { label: string | null; words: Word[] }[] = [];
  for (const w of run) {
    const label = segmentAt(segs, (w.startMs + w.endMs) / 2)?.label ?? null;
    const cur = out.at(-1);
    if (cur && cur.label === label) cur.words.push(w);
    else out.push({ label, words: [w] });
  }
  return out;
}

export function buildUtterances(o: { sessionId: string; words: Word[]; segments: SpeakerSegment[]; voiceMap: Record<string, string | null>; mode: 'diarized' | 'tracks'; wallTs: string; trackOwner?: string }): DomainEvent[] {
  const events: DomainEvent[] = [];
  for (const run of splitIntoUtterances(o.words)) {
    for (const part of o.mode === 'tracks' ? [{ label: null, words: run }] : byLabel(run, o.segments)) {
      const startMs = part.words[0]!.startMs;
      const endMs = part.words.at(-1)!.endMs;
      const id = `u${startMs}`;
      const text = part.words.map((w) => w.text).join(' ').replace(/\s+([.,!?;:])/g, '$1');
      let participantKey = 'UNK';
      let confidence = HOLD;
      let confirmedBy: 'auto' | 'operator' = 'auto';
      let signals: Record<string, unknown> = {};
      if (o.mode === 'tracks' && o.trackOwner) {
        participantKey = o.trackOwner;
        confidence = 1;
        signals = { channel: o.trackOwner };
      } else if (part.label) {
        const seg = segmentAt(o.segments, (startMs + endMs) / 2)!;
        const named = o.voiceMap[part.label] ?? null;
        signals = { diarLabel: part.label };
        if (named) {
          participantKey = named;
          const edge = nearChange(o.segments, startMs, endMs, part.label);
          confidence = edge ? HOLD : Math.min(0.95, seg.confidence);
          confirmedBy = edge ? 'auto' : 'operator';
        }
      }
      events.push({
        eventId: `${o.sessionId}:${id}`,
        sessionId: o.sessionId,
        type: 'utterance.final',
        actor: 'system',
        mediaMs: endMs,
        wallTs: o.wallTs,
        payload: { utterance: { id, participantKey, startMs, endMs, text, words: part.words.map((w) => ({ text: w.text, startMs: w.startMs, endMs: w.endMs, ...(w.confidence !== undefined ? { confidence: w.confidence } : {}) })), attribution: { confidence, signals, confirmedBy }, overlapsWith: [] } },
      } as DomainEvent);
      if (confidence < 0.85) {
        const candidates: Record<string, number> = participantKey === 'UNK' ? {} : { [participantKey]: confidence };
        events.push({ eventId: `${o.sessionId}:${id}:pending`, sessionId: o.sessionId, type: 'attribution.pending', actor: 'system', mediaMs: endMs, wallTs: o.wallTs, payload: { utteranceId: id, candidates } } as DomainEvent);
      }
    }
  }
  return events;
}
```

Check `packages/ontology/src/entities.ts` for the `Word` and `AttributionSignals` field names before running. If `Word` uses `start`/`end` or `AttributionSignals` names keys differently, change the two object literals above to match. Do not change the ontology.

- [ ] **Step 6: Run the tests and confirm they pass.** Run `pnpm --filter @adl/web test -- utterances`. Expected: PASS (4 tests).

- [ ] **Step 7: Check by hand on a real recording.** Run `pnpm dev`, then on `/host/prepare` complete step 4 (the bundle loads). In the browser console on that page, run a 3-minute clip of a fixture (`fixtures/antidebate/ball-kokotajlo-ai-governance/*.m4a`, trimmed with `ffmpeg -t 180`) through `decodeToChannels` and `DiarizeClient.load().then(c => c.diarize(mono, 3))`. Expected: segments with 2–3 labels, and label changes near the known turn changes. Note the wall time taken.

- [ ] **Step 8: Commit**

```bash
git add apps/web/scripts apps/web/public/sherpa/diarize-worker.js apps/web/lib/diarize apps/web/lib/recording/utterances.ts apps/web/lib/recording/utterances.test.ts apps/web/package.json .gitignore .vercelignore
git commit -m "web: in-browser speaker separation for recordings; unsure speakers are held, never guessed"
```

---

### Task 12: The recording flow: host home, new session, runner with resume

**Files:**
- Create:
  - `apps/web/lib/recording/checkpoint.ts`
  - `apps/web/lib/recording/pipeline.ts`, `apps/web/lib/recording/pipeline.test.ts`
  - `apps/web/app/host/page.tsx`
  - `apps/web/app/host/new/page.tsx`, `apps/web/app/host/new/HostNewForm.tsx`
  - `apps/web/app/host/s/[id]/page.tsx`, `apps/web/app/host/s/[id]/Runner.tsx`, `apps/web/app/host/s/[id]/VoiceNaming.tsx`
- Modify:
  - `apps/web/app/new/NewSessionForm.tsx` (export `ParticipantRows` for reuse; the old recording command block is deleted)

**Interfaces:**
- Consumes: Tasks 3 (session route, token), 5 (`setCaller`, `browserCaller`), 6–7 (`SessionEngine`, `HttpEventLog`, `OutboxStore`), 8 (`getKey`), 9 (`decodeToChannels`, `planChunks`, `mergeChunkWords`), 10 (`AsrClient`), 11 (`DiarizeClient`, `buildUtterances`).
- Produces:
  - `idbCheckpoint(sessionId): { outbox: OutboxStore; getChunk(i): Promise<Word[] | null>; putChunk(i, words): Promise<void>; getMeta(): Promise<RecordingMeta | null>; putMeta(m): Promise<void> }`
  - `type RecordingMeta = { fileName: string; fileSize: number; durationMs: number; segments: SpeakerSegment[]; voiceMap: Record<string, string | null> }`
  - `runRecording(o: { sessionId; file: File; token: () => Promise<string>; asr: Pick<AsrClient,'transcribe'>; checkpoint; onStage(s: Stage): void; engine: { start(log): Promise<void> } }): Promise<void>`
  - `type Stage = { kind: 'decoding' } | { kind: 'separating' } | { kind: 'naming'; segments: SpeakerSegment[] } | { kind: 'transcribing'; done: number; total: number } | { kind: 'analysing'; processedMs: number; totalMs: number } | { kind: 'done' } | { kind: 'error'; message: string }`

Flow: decode → (meta cached? skip) separate speakers → **pause for naming** (voice map saved to meta) → for each chunk not in the checkpoint, transcribe and `putChunk` → after each chunk, build utterances from the merged words so far and `append` them (idempotent ids) → run `SessionEngine` over the `HttpEventLog` until `session.ended`.

- [ ] **Step 1: Write the checkpoint store** (IndexedDB, one database per session)

```ts
// apps/web/lib/recording/checkpoint.ts
import type { DomainEvent } from '@adl/core';
import type { OutboxStore } from '@adl/engine';
import type { Word } from '@/lib/asr/chunks';
import type { SpeakerSegment } from '@/lib/diarize/client';

export type RecordingMeta = { fileName: string; fileSize: number; durationMs: number; segments: SpeakerSegment[]; voiceMap: Record<string, string | null> };

function open(sessionId: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(`adl-host-${sessionId}`, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function get<T>(db: IDBDatabase, key: string): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const q = db.transaction('kv').objectStore('kv').get(key);
    q.onsuccess = () => resolve((q.result as T | undefined) ?? null);
    q.onerror = () => reject(q.error);
  });
}

async function put(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = db.transaction('kv', 'readwrite');
    t.objectStore('kv').put(value, key);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function idbCheckpoint(sessionId: string) {
  const db = await open(sessionId);
  const outbox: OutboxStore = {
    load: async () => (await get<DomainEvent[]>(db, 'outbox')) ?? [],
    save: (p) => put(db, 'outbox', p),
  };
  return {
    outbox,
    getChunk: (i: number) => get<Word[]>(db, `chunk:${i}`),
    putChunk: (i: number, w: Word[]) => put(db, `chunk:${i}`, w),
    getMeta: () => get<RecordingMeta>(db, 'meta'),
    putMeta: (m: RecordingMeta) => put(db, 'meta', m),
  };
}
export type Checkpoint = Awaited<ReturnType<typeof idbCheckpoint>>;
```

- [ ] **Step 2: Write the failing orchestration test** (fakes for decode, ASR and the engine; proves resume skips finished chunks)

```ts
// apps/web/lib/recording/pipeline.test.ts
import { describe, expect, it, vi } from 'vitest';
import { MemoryOutbox } from '@adl/engine';
import { runRecording, type Stage } from './pipeline';

vi.mock('@/lib/audio/decode', () => ({ decodeToChannels: async () => ({ channels: [new Float32Array(16_000 * 130)], mono: new Float32Array(16_000 * 130), durationMs: 130_000 }) }));

function memCheckpoint(done: number[]) {
  const chunks = new Map<number, unknown>(done.map((i) => [i, [{ text: `c${i}`, startMs: i * 56_000 + 1000, endMs: i * 56_000 + 1300 }]]));
  let meta: unknown = { fileName: 'f', fileSize: 1, durationMs: 130_000, segments: [{ startMs: 0, endMs: 130_000, label: 'S0', confidence: 0.9 }], voiceMap: { S0: 'A' } };
  return { outbox: new MemoryOutbox(), getChunk: async (i: number) => (chunks.get(i) as never) ?? null, putChunk: async (i: number, w: unknown) => void chunks.set(i, w), getMeta: async () => meta as never, putMeta: async (m: unknown) => void (meta = m) };
}

describe('runRecording', () => {
  it('resumes: only unfinished chunks are transcribed', async () => {
    const transcribe = vi.fn(async (_pcm: Float32Array, offsetMs: number) => [{ text: 'w', startMs: offsetMs + 2000, endMs: offsetMs + 2300 }]);
    const stages: Stage['kind'][] = [];
    const appended: string[] = [];
    await runRecording({
      sessionId: 's',
      file: new File([new Uint8Array(1)], 'f'),
      token: async () => 't',
      asr: { transcribe },
      checkpoint: memCheckpoint([0, 1]),
      onStage: (s) => stages.push(s.kind),
      engine: { start: async (log) => { appended.push(...(await log.read(0)).events.map((e) => e.eventId)); } },
      makeLog: () => ({ kind: 'http', where: 'mem', append: async (e) => void appended.push(...e.map((x) => x.eventId)), read: async () => ({ cursor: 0, events: [] }), logCall: async () => {}, hydrate: async () => {}, close: async () => {} }),
    });
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(transcribe.mock.calls[0]![1]).toBe(112_000);
    expect(stages).not.toContain('naming');
    expect(stages.at(-1)).toBe('done');
  });
});
```

- [ ] **Step 3: Run it and confirm it fails.** Run `pnpm --filter @adl/web test -- pipeline`. Expected: FAIL.

- [ ] **Step 4: Implement the orchestrator**

```ts
// apps/web/lib/recording/pipeline.ts
/**
 * One recording, end to end, in the host's tab (spec §6.4, §7). Every step checkpoints,
 * so closing the tab pauses rather than loses work: reopening resumes at the first
 * unfinished chunk, and utterance/event ids are deterministic, so nothing duplicates.
 */
import type { EventLog } from '@adl/engine';
import { decodeToChannels } from '@/lib/audio/decode';
import { mergeChunkWords, planChunks, type Word } from '@/lib/asr/chunks';
import type { SpeakerSegment } from '@/lib/diarize/client';
import type { Checkpoint } from './checkpoint';
import { buildUtterances } from './utterances';

export type Stage =
  | { kind: 'decoding' }
  | { kind: 'separating' }
  | { kind: 'naming'; segments: SpeakerSegment[] }
  | { kind: 'transcribing'; done: number; total: number }
  | { kind: 'analysing'; processedMs: number; totalMs: number }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

type HostLog = EventLog & { hydrate(): Promise<void>; close(): Promise<void> };

export async function runRecording(o: {
  sessionId: string;
  file: File;
  token: () => Promise<string>;
  asr: { transcribe(pcm: Float32Array, offsetMs: number): Promise<Word[]> };
  checkpoint: Pick<Checkpoint, 'outbox' | 'getChunk' | 'putChunk' | 'getMeta' | 'putMeta'>;
  onStage: (s: Stage) => void;
  /** Separates speakers and waits for the host to name them; returns the voice map. Not called when the meta already has one. */
  separateAndName?: (mono: Float32Array, durationMs: number) => Promise<{ segments: SpeakerSegment[]; voiceMap: Record<string, string | null> }>;
  engine: { start(log: HostLog): Promise<void> };
  makeLog: () => HostLog;
}): Promise<void> {
  try {
    const log = o.makeLog();
    await log.hydrate();
    o.onStage({ kind: 'decoding' });
    const { mono, durationMs } = await decodeToChannels(o.file);
    let meta = await o.checkpoint.getMeta();
    if (!meta || meta.fileSize !== o.file.size) {
      if (!o.separateAndName) throw new Error('speaker separation is not available');
      o.onStage({ kind: 'separating' });
      const named = await o.separateAndName(mono, durationMs);
      meta = { fileName: o.file.name, fileSize: o.file.size, durationMs, ...named };
      await o.checkpoint.putMeta(meta);
    }
    const plan = planChunks(durationMs);
    const results: { startMs: number; endMs: number; words: Word[] }[] = [];
    for (const c of plan) {
      let words = await o.checkpoint.getChunk(c.index);
      if (!words) {
        words = await o.asr.transcribe(mono.subarray(Math.floor((c.startMs * 16_000) / 1000), Math.floor((c.endMs * 16_000) / 1000)), c.startMs);
        await o.checkpoint.putChunk(c.index, words);
      }
      results.push({ startMs: c.startMs, endMs: c.endMs, words });
      o.onStage({ kind: 'transcribing', done: c.index + 1, total: plan.length });
      // Emit everything that can no longer change: words before the next chunk's overlap.
      const safeUntil = plan[c.index + 1]?.startMs ?? Infinity;
      const stable = mergeChunkWords(results).filter((w) => w.endMs <= safeUntil);
      await log.append(buildUtterances({ sessionId: o.sessionId, words: stable, segments: meta.segments, voiceMap: meta.voiceMap, mode: 'diarized', wallTs: new Date().toISOString() }));
    }
    o.onStage({ kind: 'analysing', processedMs: 0, totalMs: durationMs });
    await o.engine.start(log);
    await log.close();
    o.onStage({ kind: 'done' });
  } catch (e) {
    o.onStage({ kind: 'error', message: (e as Error).message });
  }
}
```

Note: `buildUtterances` is re-run over all stable words after each chunk. Utterance ids are `u<startMs>`, so earlier utterances re-emit with the same ids, and `HttpEventLog.append` drops them.

**Edge case:** an utterance still growing across a chunk seam could be emitted short and then again longer, under the same id. The emit is limited to words ending before the next chunk's start, but a run can still continue across it. The fix is to also drop the last utterance of `stable` unless this is the final chunk. Add that: `const runs = …; if (c.index < plan.length - 1) drop the final run`. Implement it inside `buildUtterances`' caller by trimming `stable` to end before the last gap of 800 ms or more. Add a test for this in `pipeline.test.ts`: two chunks where one utterance spans the seam must yield exactly one `utterance.final` for it.

- [ ] **Step 5: Run the tests and confirm they pass.** Run `pnpm --filter @adl/web test -- pipeline`. Expected: PASS (both tests).

- [ ] **Step 6: Build the screens.**
  - **`app/host/page.tsx`:** `<HostBar/>` plus a list of this device's sessions (`localStorage['adl.hostSessions']`, an array of `{id,title,createdAt,kind}`). Each links to `/host/s/<id>`.
    - Three actions: "Process a recording" (`/host/new?kind=recording`), "New live session" (`/host/new?kind=live`, disabled with the note "Coming next: live capture"), and "Prepare this laptop" (`/host/prepare`). The prepare action is highlighted until `adl.prepared` is set.
    - Missing key → `redirect` client-side to `/host/key?next=/host`.
  - **`app/host/new/HostNewForm.tsx`:**
    - Title, format (from `FORMATS`), participant rows (reuse `ParticipantRows` from `NewSessionForm.tsx`), the question "How will the audio reach this laptop?" with the four options (Plan 1 enables only "A recording"), and a file input (`accept="audio/*,video/*"`).
    - The note: "YouTube links can't be processed here: YouTube blocks servers from downloading. Download the video first (for example with yt-dlp or the creator's own copy), then choose the file."
    - Submit → `POST /api/host/session` with `source: { kind: 'recording', file: file.name }` → save `{id,title,…}` to `adl.hostSessions` → keep the `File` in memory → navigate to `/host/s/<id>` with the file handed over via a module-level `pendingFiles` Map keyed by session id.
  - **`app/host/s/[id]/Runner.tsx`:**
    - Gets the token via `POST /api/host/session {sessionId}`, and `idbCheckpoint(id)`.
    - Calls `setCaller(browserCaller(getKey()!))`, loads `AsrClient` and `DiarizeClient`, and calls `runRecording`, with:
      - `makeLog = () => new HttpEventLog({ sessionId: id, token, outbox: cp.outbox })`
      - `engine.start = (log) => new SessionEngine({ sessionId: id, log, silenceMs: 0, onProgress }).run()` after `finishSource()`
      - `separateAndName`: runs `diarize(mono, debaterCount + moderatorCount)`, then renders `<VoiceNaming>` and resolves when the host confirms.
    - Stage UI, one line each:
      - "Reading the file"
      - "Separating speakers"
      - "Name the voices"
      - "Transcribing: chunk N of M"
      - "Analysing: 34 of 92 minutes"
      - "Done: open the map"
    - "Done" links to `/s/<id>/spatial` and `/s/<id>/cockpit`.
    - The spend estimate comes from summing `billedUsd` in `onCall`, labelled "estimated spend".
    - The outbox count is shown when above 0 ("12 events waiting to upload").
    - A `beforeunload` warning while running: "Processing pauses if you close this tab. You can resume from this page."
    - If the page opens without a file in memory but the checkpoint has meta, it shows "Choose the same file again to resume" with a file input, and checks that `fileName` and `fileSize` match.
  - **`VoiceNaming.tsx`:** for each label, the three longest segments as play buttons (each plays that span of the mono buffer through an `AudioBufferSourceNode`), and a select of the session's participants plus "Someone else (don't attribute)". Confirm → `voiceMap`.

- [ ] **Step 7: Full manual run, with no API spend: the mocked-key path.**
  - Set `localStorage['adl.anthropicKey'] = 'sk-ant-fake'`.
  - Process a 3-minute fixture clip.
  - Expected:
    - stages advance through naming and transcribing;
    - utterances appear on `/s/<id>/console`;
    - the analysis stage shows `provider_error` lines in the host view ("Analysis delayed");
    - the session still ends.
  - Reload mid-transcription and re-choose the file. Expected: it resumes at the next chunk, and the utterance count on the console matches with no duplicates.

- [ ] **Step 8: One real-key run, only with Benjamin's explicit approval.**
  - Ask first.
  - With approval, process the same 3-minute clip on his key, and record in `evals/results.md`: wall time, `billedUsd` total, card counts.
  - Compare with the worker's output for the same span (`pnpm --filter @adl/worker run:session` from cache).

- [ ] **Step 9: Commit**

```bash
git add apps/web/lib/recording apps/web/app/host apps/web/app/new/NewSessionForm.tsx evals/results.md
git commit -m "web: host recording flow: name the voices, transcribe and analyse in the tab, resume after closing"
```

---

### Task 13: Configure production, write the guides, and verify end to end

**Files:**
- Create:
  - `docs/HOSTING.md`: the host's guide, and the text Benjamin sends Stephanie and Liv
  - `apps/web/e2e/host.spec.ts` (Playwright, with Anthropic mocked)
- Modify:
  - `docs/R0_DEMO.md` (event-day checklist)
  - `docs/NEXT_STEPS.md` §0
  - `README.md` (status line)

- [ ] **Step 1: E2E test** (mocked Anthropic and ASR; runs against `pnpm dev`)

```ts
// apps/web/e2e/host.spec.ts
import { expect, test } from '@playwright/test';

test('a visitor cannot host; a host signs in and reaches the key step', async ({ page }) => {
  await page.goto('/host/new');
  await expect(page).toHaveURL(/\/host\/login\?next=%2Fhost%2Fnew/);
  await page.getByLabel('Host password').fill('wrong');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText('That password is not right.');
  await page.getByLabel('Host password').fill(process.env.HOST_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.route('https://api.anthropic.com/**', (r) => r.fulfill({ status: 401, body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid' } }) }));
  await page.goto('/host/key');
  await page.getByLabel('Anthropic API key').fill('sk-ant-fake');
  await page.getByRole('button', { name: 'Check and save' }).click();
  await expect(page.getByRole('alert')).toContainText("That key wasn't accepted");
});

test('the public home lists no live sessions and has a host link', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Host a session' })).toBeVisible();
  await expect(page.getByText('Live', { exact: true })).toHaveCount(0);
});
```

Run: `pnpm --filter @adl/web add -D @playwright/test && HOST_PASSWORD=test HOST_SIGNING_SECRET=0123456789abcdef0123 pnpm dev` in one terminal, then `HOST_PASSWORD=test npx playwright test apps/web/e2e` in another.
Expected: 2 passed.

- [ ] **Step 2: Write `docs/HOSTING.md`.** It opens with a message Benjamin can paste to hosts, then the steps:
  1. Open antidebate.xyz/host in Chrome on a laptop.
  2. Enter the host password.
  3. Follow the Anthropic key steps. Create the account a few days early.
  4. Prepare this laptop once, on good Wi-Fi, ideally the day before.
  5. Process a recording: choose the file, name the voices, keep the tab open (you can close it and resume).
  6. Share the map link.

  Then a "When something goes wrong" table, with every message from Task 8 and the stage errors from Task 12, each with its fix. No emoji, no filler.

- [ ] **Step 3: Set the production secrets. Ask Benjamin first:** "What should the host password be? I'll generate the signing secret." With his answer:

```bash
openssl rand -base64 32 | vercel env add HOST_SIGNING_SECRET production
printf '%s' '<password from Benjamin>' | vercel env add HOST_PASSWORD production
```

Also set both for `preview`. Never echo them into the transcript or commit them.

- [ ] **Step 4: Deploy a preview and verify** (only after Benjamin approves deploying):
  - `vercel deploy`
  - `vercel curl /host/new` shows a redirect to login
  - the sign-in works
  - `/host/prepare` loads the sherpa bundle from `/sherpa/` (it was built by `prebuild`)
  - a 3-minute recording completes with the fake key (utterances visible, analysis delayed)

  Then promote to production when Benjamin says so.

- [ ] **Step 5: Update the docs and commit**

```bash
git add docs/HOSTING.md docs/R0_DEMO.md docs/NEXT_STEPS.md README.md apps/web/e2e apps/web/package.json pnpm-lock.yaml
git commit -m "docs: host guide; e2e for the host gate and key check"
```

---

## Self-review

- **Spec coverage:**
  - §3: Tasks 1–4.
  - §4: Task 8. The spend estimate is in Task 12's runner.
  - §5 for recordings: Task 11. Live fusion and the attributor are Plan 2; the quality gate is Plan 3.
  - §6.4: Tasks 11–12.
  - §6.1–6.3: Plan 2. The screens exist, disabled with "Coming next".
  - §7:
    - transport: Task 5;
    - engine move: Task 6;
    - HttpEventLog and outbox: Task 7;
    - ASR: Task 10;
    - resumable recordings: Task 12;
    - live-tab recovery: Plan 2.
  - §8: login (Task 2), key (Task 8), prepare (Task 10), home, new and runner (Task 12).
  - §9: the messages in Tasks 2, 8, 10, 11 and 12 cover:
    - wrong password;
    - bad key, no credit, rate limit, unreachable;
    - download interrupted;
    - unreadable file;
    - speaker separation failing to load;
    - outbox;
    - token re-issue.

    The mic and channel errors are Plan 2.
  - §10: unit tests throughout; e2e in Task 13; the manual list lands in Plan 3.
- **Placeholders:** none. Two steps say to confirm field names against installed type definitions (parakeet.js progress option, ontology `Word`), and each gives the exact file to read.
- **Type consistency:**
  - `Word` (`startMs`, `endMs`) is used by chunks, ASR, utterances and pipeline.
  - `SpeakerSegment` is used by diarize, utterances and pipeline.
  - `OutboxStore` is used by the engine and checkpoint.
  - `setCaller`/`browserCaller` are used by the runner.
  - `EventLog.kind` includes `'http'`.
- **Review Focus** tests are in Tasks 3 (cross-session 403), 7 and 12 (resume, no duplicates), 8 (offline vs bad key), 11 (unnamed voice → UNK and pending) and 1 (tampered or expired cookie).
