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

  it('resumes after a reload: turns the log shows as finished are not analysed again', async () => {
    const extracted: string[] = [];
    setCaller(async (c) => { if (c.pass === 'L1_extract') extracted.push(c.input); return { ok: false, reason: 'provider_error', detail: 'offline test', log: { pass: c.pass } as never }; });
    const log = new MemLog();
    const closed = (n: number, who: string, u: string): DomainEvent => ({ eventId: `${sid}:t000${n}:closed`, sessionId: sid, type: 'turn.closed', actor: 'system', mediaMs: 0, wallTs: w, payload: { turnId: `${sid}:t000${n}`, participantKey: who, utteranceIds: [u] } });
    await log.append([
      { eventId: `${sid}:start`, sessionId: sid, type: 'session.started', actor: 'operator', mediaMs: 0, wallTs: w, payload: { title: 'T', format: 'open', participants: [{ key: 'A', displayName: 'Ann', role: 'debater' }, { key: 'B', displayName: 'Bo', role: 'debater' }] } },
      utt('u1', 'A', 0, 'First claim about taxes.'),
      utt('u2', 'B', 3000, 'Second claim about spending.'),
      utt('u3', 'A', 6000, 'Third claim about growth.'),
      // A previous run closed t0000 and t0001; t0001 was the last one started, so it may be unfinished.
      closed(0, 'A', 'u1'),
      closed(1, 'B', 'u2'),
    ]);
    const engine = new SessionEngine({ sessionId: sid, log, pollMs: 5, silenceMs: 1 });
    engine.finishSource();
    await engine.run();
    // t0000 is skipped; t0001 (possibly unfinished) and t0002 are extracted. Earlier turns appear as context only.
    expect(extracted).toHaveLength(2);
    expect(extracted[0]).toContain('Second claim');
    expect(extracted[1]).toContain('Third claim');
    expect(log.events.at(-1)!.type).toBe('session.ended');
  });
});
