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
