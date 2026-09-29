import { expect, it } from 'vitest';
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

const sid = 'r1';
const w = new Date(0).toISOString();
const utt = (id: string, who: string, startMs: number, text: string): DomainEvent => ({
  eventId: `${sid}:${id}`, sessionId: sid, type: 'utterance.final', actor: 'system', mediaMs: startMs + 1500, wallTs: w,
  payload: { utterance: { id, participantKey: who, startMs, endMs: startMs + 1500, text, words: [], attribution: { confidence: 1, signals: {}, confirmedBy: 'auto' }, overlapsWith: [] } },
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const closedTurns = (log: MemLog) => log.events.flatMap((e) => (e.type === 'turn.closed' ? [e.payload] : []));

it('a reload keeps turning and extracting new lines after live turns closed on silence', async () => {
  const extracted: string[] = [];
  setCaller(async (c) => { if (c.pass === 'L1_extract') extracted.push(c.input); return { ok: false, reason: 'provider_error', detail: 'offline test', log: { pass: c.pass } as never }; });
  const log = new MemLog();
  await log.append([{ eventId: `${sid}:start`, sessionId: sid, type: 'session.started', actor: 'operator', mediaMs: 0, wallTs: w, payload: { title: 'T', format: 'open', participants: [{ key: 'A', displayName: 'Ann', role: 'debater' }, { key: 'B', displayName: 'Bo', role: 'debater' }] } }]);

  // Live: short lines from A, each closed by silence into its own turn.
  const e1 = new SessionEngine({ sessionId: sid, log, pollMs: 5, silenceMs: 30 });
  const r1 = e1.run();
  for (let i = 0; i < 6; i++) { await log.append([utt(`u${i}`, 'A', i * 1600, `short words ${i}`)]); await sleep(80); }
  e1.stop();
  await r1;
  const live = closedTurns(log);
  expect(live.length).toBeGreaterThan(1);
  const extractedLive = extracted.length;

  // Reload: a new engine replays the log, then B speaks.
  const e2 = new SessionEngine({ sessionId: sid, log, pollMs: 5, silenceMs: 30 });
  const r2 = e2.run();
  await sleep(50);
  await log.append([utt('uB1', 'B', 20_000, 'new words from B')]);
  await sleep(80);
  await log.append([utt('uA2', 'A', 23_000, 'new words from A')]);
  await sleep(80);
  e2.finishSource();
  await r2;

  const all = closedTurns(log);
  const ids = all.map((t) => t.turnId);
  expect(new Set(ids).size).toBe(ids.length);
  expect(all.find((t) => t.utteranceIds.includes('uB1'))?.participantKey).toBe('B');
  expect(all.some((t) => t.utteranceIds.includes('uA2'))).toBe(true);
  expect(extracted.some((s) => s.includes('new words from B'))).toBe(true);
  expect(extracted.some((s) => s.includes('new words from A'))).toBe(true);
  // Replayed turns keep their logged ids and boundaries: only the last live turn (no L1 output logged,
  // so possibly unfinished) runs again, plus the two new turns.
  expect(extracted.length - extractedLive).toBe(3);
  expect(all.slice(0, live.length)).toEqual(live);
});
