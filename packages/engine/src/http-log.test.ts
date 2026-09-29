import { describe, expect, it, vi } from 'vitest';
import type { DomainEvent } from '@adl/core';
import { HttpEventLog, MemoryOutbox } from './http-log';

const ev = (n: number): DomainEvent => ({ eventId: `s:${n}`, sessionId: 's', type: 'round.ended', actor: 'system', mediaMs: n, wallTs: new Date(0).toISOString(), payload: { roundId: 'r' } });

function server(opts: { failFirst?: number; existing?: DomainEvent[] } = {}) {
  const stored: DomainEvent[] = [...(opts.existing ?? [])];
  let fails = opts.failFirst ?? 0;
  const f = (async (url: string, init?: RequestInit) => {
    if (!init || init.method === 'GET' || !init.method) {
      const after = Number(new URL(url, 'http://x').searchParams.get('after'));
      const page = stored.slice(after, after + 1000);
      return Response.json({ events: page, cursor: after + page.length, hasMore: after + page.length < stored.length });
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
    await log.close();
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
    await log.close();
  });
  it('refreshes the token once on a 401 and retries the post', async () => {
    const stored: DomainEvent[] = [];
    const seen: string[] = [];
    const f = (async (_url: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>).authorization;
      seen.push(auth ?? '');
      if (auth !== 'Bearer fresh') return new Response('expired', { status: 401 });
      const { events } = JSON.parse(String(init?.body)) as { events: DomainEvent[] };
      stored.push(...events);
      return Response.json({ accepted: events.length });
    }) as unknown as typeof fetch;
    let issued = 0;
    const token = async () => (++issued === 1 ? 'stale' : 'fresh');
    const log = new HttpEventLog({ sessionId: 's', token, outbox: new MemoryOutbox(), fetch: f, flushEveryMs: 1_000_000 });
    await log.append([ev(1)]);
    await log.flush();
    expect(issued).toBe(2);
    expect(seen).toEqual(['Bearer stale', 'Bearer fresh']);
    expect(stored.map((e) => e.eventId)).toEqual(['s:1']);
    expect(log.pending()).toBe(0);
    await log.close();
  });
  it('close() with a failing server leaves no timer and sends nothing afterwards', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const f = (async () => { calls++; return new Response('down', { status: 503 }); }) as unknown as typeof fetch;
      const statuses: unknown[] = [];
      const log = new HttpEventLog({ sessionId: 's', token: async () => 't', outbox: new MemoryOutbox(), fetch: f, flushEveryMs: 10 });
      log.onStatus = (x) => statuses.push(x);
      await log.append([ev(1)]);
      await log.close();
      const callsAtClose = calls;
      const statusesAtClose = statuses.length;
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(calls).toBe(callsAtClose);
      expect(statuses.length).toBe(statusesAtClose);
      expect(log.pending()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it('hydrate refreshes the token once on a 401', async () => {
    const seen: string[] = [];
    const f = (async (_url: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>).authorization ?? '';
      seen.push(auth);
      if (auth !== 'Bearer fresh') return new Response('expired', { status: 401 });
      return Response.json({ events: [ev(1)], cursor: 1, hasMore: false });
    }) as unknown as typeof fetch;
    let issued = 0;
    const log = new HttpEventLog({ sessionId: 's', token: async () => (++issued === 1 ? 'stale' : 'fresh'), outbox: new MemoryOutbox(), fetch: f, flushEveryMs: 1_000_000 });
    await log.hydrate();
    expect(issued).toBe(2);
    expect(seen).toEqual(['Bearer stale', 'Bearer fresh']);
    expect((await log.read(0)).events).toHaveLength(1);
    await log.close();
  });
  it('a throwing outbox.save still delivers and reports lastError', async () => {
    const { stored, f } = server();
    const outbox = { load: async () => [], save: async () => { throw new Error('quota'); } };
    const statuses: { pending: number; lastError: string | null }[] = [];
    const log = new HttpEventLog({ sessionId: 's', token: async () => 't', outbox, fetch: f, flushEveryMs: 1_000_000 });
    log.onStatus = (x) => statuses.push(x);
    await expect(log.append([ev(1), ev(2)])).resolves.toBeUndefined();
    await expect(log.flush()).resolves.toBeUndefined();
    expect(stored.map((e) => e.eventId)).toEqual(['s:1', 's:2']);
    expect(log.pending()).toBe(0);
    expect(statuses.some((x) => x.lastError === 'Could not save progress on this device')).toBe(true);
    await log.close();
  });
  it('hydrate pages through the server log while it says there is more', async () => {
    const existing = Array.from({ length: 2500 }, (_, i) => ev(i));
    const { f } = server({ existing });
    const gets: string[] = [];
    const counting = (async (url: string, init?: RequestInit) => { if (!init?.method) gets.push(url); return f(url, init); }) as unknown as typeof fetch;
    const log = new HttpEventLog({ sessionId: 's', token: async () => 't', outbox: new MemoryOutbox(), fetch: counting, flushEveryMs: 1_000_000 });
    await log.hydrate();
    expect((await log.read(0)).events).toHaveLength(2500);
    expect(gets).toHaveLength(3);
    await log.close();
  });
  it('hydrate follows hasMore, not the page length', async () => {
    const pages = [{ events: [ev(1)], cursor: 10, hasMore: true }, { events: [ev(2)], cursor: 20, hasMore: false }];
    const afters: string[] = [];
    const f = (async (url: string) => { afters.push(new URL(url, 'http://x').searchParams.get('after')!); return Response.json(pages.shift()); }) as unknown as typeof fetch;
    const log = new HttpEventLog({ sessionId: 's', token: async () => 't', outbox: new MemoryOutbox(), fetch: f, flushEveryMs: 1_000_000 });
    await log.hydrate();
    expect(afters).toEqual(['0', '10']);
    expect((await log.read(0)).events).toHaveLength(2);
    await log.close();
  });
  it('close() resolves to the number of events still waiting', async () => {
    const down = (async () => new Response('down', { status: 503 })) as unknown as typeof fetch;
    const log = new HttpEventLog({ sessionId: 's', token: async () => 't', outbox: new MemoryOutbox(), fetch: down, flushEveryMs: 1_000_000 });
    await log.append([ev(1), ev(2)]);
    expect(await log.close()).toBe(2);
    expect(log.status()).toEqual({ pending: 2, lastError: 'The server returned 503' });
    const { f } = server();
    const ok = new HttpEventLog({ sessionId: 's', token: async () => 't', outbox: new MemoryOutbox(), fetch: f, flushEveryMs: 1_000_000 });
    await ok.append([ev(1)]);
    expect(await ok.close()).toBe(0);
  });
  it('a permanent 4xx is not retried on a timer and is reported', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const f = (async () => { calls++; return new Response('gone', { status: 409 }); }) as unknown as typeof fetch;
      const statuses: { pending: number; lastError: string | null }[] = [];
      const log = new HttpEventLog({ sessionId: 's', token: async () => 't', outbox: new MemoryOutbox(), fetch: f, flushEveryMs: 10 });
      log.onStatus = (x) => statuses.push(x);
      await log.append([ev(1)]);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(calls).toBe(1);
      expect(statuses.at(-1)).toEqual({ pending: 1, lastError: 'The server refused these events (409)' });
      await log.close();
    } finally {
      vi.useRealTimers();
    }
  });
  it('append reports the new pending count', async () => {
    const statuses: { pending: number; lastError: string | null }[] = [];
    const { f } = server();
    const log = new HttpEventLog({ sessionId: 's', token: async () => 't', outbox: new MemoryOutbox(), fetch: f, flushEveryMs: 1_000_000 });
    log.onStatus = (x) => statuses.push(x);
    await log.append([ev(1), ev(2)]);
    expect(statuses).toEqual([{ pending: 2, lastError: null }]);
    await log.close();
  });
  it('loadOutbox picks up the device outbox without reading the server log', async () => {
    const outbox = new MemoryOutbox();
    await outbox.save([ev(4), ev(5)]);
    const { stored, f } = server({ existing: [ev(1)] });
    const gets: string[] = [];
    const counting = (async (url: string, init?: RequestInit) => { if (!init?.method) gets.push(url); return f(url, init); }) as unknown as typeof fetch;
    const log = new HttpEventLog({ sessionId: 's', token: async () => 't', outbox, fetch: counting, flushEveryMs: 1_000_000 });
    await log.loadOutbox();
    expect(log.pending()).toBe(2);
    expect(await log.close()).toBe(0);
    expect(gets).toEqual([]);
    expect(stored.map((e) => e.eventId)).toEqual(['s:1', 's:4', 's:5']);
    expect(await outbox.load()).toEqual([]);
  });
});
