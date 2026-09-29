/**
 * Session index. Neon: every `session.started` event, newest first, with counts.
 * Local: every `.data/*.events.jsonl` that contains a `session.started` line.
 */
import 'server-only';
import { closeSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import path from 'node:path';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import type { EventOf } from '@adl/core';
import { getDb, hasDb, schema, toIso } from '@adl/db';
import { DATA_DIR, isValidSessionId } from './events-source';

export interface SessionSummary {
  id: string;
  title: string;
  format: string;
  source: { kind: 'live' | 'recording'; fixture?: string; url?: string; speed?: number } | null;
  participants: { key: string; displayName: string; role: string }[];
  startedAt: string;
  eventCount?: number;
  /** Wall time of the newest event we know of (ISO). */
  lastActivityAt?: string;
  ended: boolean;
}

type Started = EventOf<'session.started'>;

function summarize(e: Started, extra: Partial<SessionSummary>): SessionSummary {
  return {
    id: e.sessionId,
    title: e.payload.title,
    format: e.payload.format,
    source: e.payload.source ?? null,
    participants: e.payload.participants,
    startedAt: e.wallTs,
    ended: false,
    ...extra,
  };
}

/** Read up to `max` bytes from the start of a file and return the complete lines. */
function headLines(file: string, max = 64 * 1024): string[] {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(max);
    const n = readSync(fd, buf, 0, max, 0);
    const text = buf.subarray(0, n).toString('utf8');
    const lines = text.split('\n');
    if (n === max) lines.pop();
    return lines;
  } finally {
    closeSync(fd);
  }
}

function tailText(file: string, size: number, max = 64 * 1024): string {
  const fd = openSync(file, 'r');
  try {
    const len = Math.min(max, size);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

function countLines(file: string, size: number): number {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(1 << 20);
    let pos = 0;
    let count = 0;
    while (pos < size) {
      const n = readSync(fd, buf, 0, buf.length, pos);
      if (n <= 0) break;
      for (let i = 0; i < n; i++) if (buf[i] === 10) count++;
      pos += n;
    }
    return count;
  } finally {
    closeSync(fd);
  }
}

function listLocal(): SessionSummary[] {
  let names: string[];
  try {
    names = readdirSync(DATA_DIR).filter((n) => n.endsWith('.events.jsonl'));
  } catch {
    return [];
  }
  const out: SessionSummary[] = [];
  for (const name of names) {
    const id = name.slice(0, -'.events.jsonl'.length);
    if (!isValidSessionId(id)) continue;
    const file = path.join(DATA_DIR, name);
    const st = statSync(file);
    const startLine = headLines(file).find((l) => l.includes('"session.started"'));
    if (!startLine) continue;
    let started: Started;
    try {
      started = JSON.parse(startLine) as Started;
    } catch {
      continue;
    }
    if (started.type !== 'session.started') continue;
    const tail = tailText(file, st.size);
    out.push(
      summarize(started, {
        id,
        eventCount: countLines(file, st.size),
        lastActivityAt: st.mtime.toISOString(),
        ended: tail.includes('"session.ended"'),
      }),
    );
  }
  return out.sort((a, b) => (b.lastActivityAt ?? b.startedAt).localeCompare(a.lastActivityAt ?? a.startedAt));
}

async function listNeon(): Promise<SessionSummary[]> {
  const db = getDb();
  const started = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.type, 'session.started'))
    .orderBy(desc(schema.events.id))
    .limit(200);
  if (started.length === 0) return [];
  const ids = started.map((r) => r.sessionId);
  const stats = await db
    .select({
      sessionId: schema.events.sessionId,
      count: sql<number>`count(*)::int`,
      last: sql<string>`max(${schema.events.wallTs})`,
      ended: sql<boolean>`bool_or(${schema.events.type} = 'session.ended')`,
    })
    .from(schema.events)
    .where(inArray(schema.events.sessionId, ids))
    .groupBy(schema.events.sessionId);
  const byId = new Map(stats.map((s) => [s.sessionId, s]));
  const seen = new Set<string>();
  const out: SessionSummary[] = [];
  for (const r of started) {
    if (seen.has(r.sessionId)) continue;
    seen.add(r.sessionId);
    const e = { eventId: r.eventId, sessionId: r.sessionId, type: 'session.started', actor: r.actor, mediaMs: r.mediaMs, wallTs: toIso(r.wallTs), payload: r.payload } as Started;
    const s = byId.get(r.sessionId);
    out.push(summarize(e, { eventCount: s?.count, lastActivityAt: s?.last ? toIso(s.last) : undefined, ended: Boolean(s?.ended) }));
  }
  return out;
}

export async function listSessions(): Promise<SessionSummary[]> {
  return hasDb() ? listNeon() : listLocal();
}

/** The public home page lists finished debates only; a live session is reachable by its link (spec §3). */
export function publicSessions(all: SessionSummary[]): SessionSummary[] {
  return all.filter((s) => s.ended);
}

/** "In progress" = not ended and something was appended in the last few minutes. */
export function isActive(s: SessionSummary, now = Date.now(), windowMs = 3 * 60_000): boolean {
  if (s.ended || !s.lastActivityAt) return false;
  return now - Date.parse(s.lastActivityAt) < windowMs;
}
