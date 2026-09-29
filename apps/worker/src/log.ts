/**
 * The event log the worker reads and writes. Postgres (Neon) when DATABASE_URL is
 * set; otherwise `.data/<session>.events.jsonl`, which the web app tails locally.
 * Both are append-only and idempotent by eventId.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { DomainEvent } from '@adl/core';
import { appendEvents, getDb, hasDb, readEvents, schema } from '@adl/db';
import type { LlmCallLog } from '@adl/llm';
import { REPO_ROOT } from './sources';

export interface EventLog {
  readonly kind: 'db' | 'file';
  readonly where: string;
  append(events: DomainEvent[]): Promise<void>;
  /** Events after `cursor`, in append order, and the new cursor. */
  read(cursor: number): Promise<{ cursor: number; events: DomainEvent[] }>;
  logCall(log: LlmCallLog): Promise<void>;
}

// Opus 5.5 list prices per MTok (ARCHITECTURE §10). Cache writes billed as input here.
export const callCostUsd = (l: LlmCallLog) =>
  (l.inputTokens + l.cacheCreationTokens) * 4e-6 + l.cacheReadTokens * 0.2e-6 + l.outputTokens * 20e-6;

class FileLog implements EventLog {
  readonly kind = 'file' as const;
  readonly where: string;
  private readonly calls: string;
  private seen = new Set<string>();
  constructor(sessionId: string, fresh: boolean) {
    mkdirSync(`${REPO_ROOT}.data`, { recursive: true });
    this.where = `${REPO_ROOT}.data/${sessionId}.events.jsonl`;
    this.calls = `${REPO_ROOT}.data/${sessionId}.calls.jsonl`;
    if (fresh || !existsSync(this.where)) writeFileSync(this.where, '');
    if (fresh || !existsSync(this.calls)) writeFileSync(this.calls, '');
  }
  private lines(): string[] {
    return readFileSync(this.where, 'utf8').split('\n').filter(Boolean);
  }
  async append(events: DomainEvent[]) {
    if (this.seen.size === 0) for (const l of this.lines()) this.seen.add((JSON.parse(l) as DomainEvent).eventId);
    const fresh = events.filter((e) => !this.seen.has(e.eventId));
    for (const e of fresh) this.seen.add(e.eventId);
    if (fresh.length) appendFileSync(this.where, fresh.map((e) => `${JSON.stringify(e)}\n`).join(''));
  }
  async read(cursor: number) {
    const lines = this.lines();
    return { cursor: lines.length, events: lines.slice(cursor).map((l) => JSON.parse(l) as DomainEvent) };
  }
  async logCall(log: LlmCallLog) {
    appendFileSync(this.calls, `${JSON.stringify({ ...log, costUsd: callCostUsd(log) })}\n`);
  }
}

class DbLog implements EventLog {
  readonly kind = 'db' as const;
  readonly where = 'Neon (DATABASE_URL)';
  constructor(private readonly sessionId: string) {}
  async append(events: DomainEvent[]) {
    // Neon's HTTP driver caps request size; append in modest batches.
    for (let i = 0; i < events.length; i += 200) await appendEvents(events.slice(i, i + 200));
  }
  async read(cursor: number) {
    const events: DomainEvent[] = [];
    let c = cursor;
    for (;;) {
      const rows = await readEvents(this.sessionId, c, 1000);
      if (rows.length === 0) break;
      c = rows.at(-1)!.cursor;
      events.push(...rows.map((r) => r.event));
      if (rows.length < 1000) break;
    }
    return { cursor: c, events };
  }
  async logCall(log: LlmCallLog) {
    await getDb()
      .insert(schema.llmCalls)
      .values({
        sessionId: this.sessionId,
        pass: log.pass,
        promptVersion: log.promptVersion,
        model: log.model,
        effort: log.effort,
        inputTokens: log.inputTokens,
        cacheReadTokens: log.cacheReadTokens,
        cacheCreationTokens: log.cacheCreationTokens,
        outputTokens: log.outputTokens,
        latencyMs: log.latencyMs,
        stopReason: log.stopReason,
        costUsd: callCostUsd(log),
      });
  }
}

export function openLog(sessionId: string, opts: { file?: boolean; fresh?: boolean } = {}): EventLog {
  return hasDb() && !opts.file ? new DbLog(sessionId) : new FileLog(sessionId, opts.fresh ?? false);
}
