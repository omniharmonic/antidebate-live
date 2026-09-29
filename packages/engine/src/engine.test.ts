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

  it('a finished source drains without sleeping between turns (hidden tabs throttle timers)', async () => {
    setCaller(async (c) => ({ ok: false, reason: 'provider_error', detail: 'offline test', log: { pass: c.pass } as never }));
    const log = new MemLog();
    await log.append([
      { eventId: `${sid}:start`, sessionId: sid, type: 'session.started', actor: 'operator', mediaMs: 0, wallTs: w, payload: { title: 'T', format: 'open', participants: [{ key: 'A', displayName: 'Ann', role: 'debater' }, { key: 'B', displayName: 'Bo', role: 'debater' }] } },
      ...Array.from({ length: 6 }, (_, i) => utt(`u${i}`, i % 2 ? 'B' : 'A', i * 3000, `Claim number ${i}.`)),
    ]);
    // A poll interval far longer than the test timeout: any sleep between turns fails the test.
    const engine = new SessionEngine({ sessionId: sid, log, pollMs: 60_000, silenceMs: 0 });
    engine.finishSource();
    await engine.run();
    expect(log.events.filter((e) => e.type === 'turn.closed')).toHaveLength(6);
    expect(log.events.at(-1)!.type).toBe('session.ended');
  }, 5_000);

  it('stop() waits for the turn in flight, then returns without ending the session', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let engine!: SessionEngine;
    setCaller(async (c) => {
      if (c.pass === 'L1_extract') { engine.stop(); await gate; }
      return { ok: false, reason: 'provider_error', detail: 'offline test', log: { pass: c.pass } as never };
    });
    const log = new MemLog();
    await log.append([
      { eventId: `${sid}:start`, sessionId: sid, type: 'session.started', actor: 'operator', mediaMs: 0, wallTs: w, payload: { title: 'T', format: 'open', participants: [{ key: 'A', displayName: 'Ann', role: 'debater' }] } },
      utt('u1', 'A', 0, 'Only claim.'),
    ]);
    engine = new SessionEngine({ sessionId: sid, log, pollMs: 5, silenceMs: 0 });
    engine.finishSource();
    let done = false;
    const running = engine.run().then(() => { done = true; });
    await new Promise((r) => setTimeout(r, 30));
    expect(done).toBe(false);
    release();
    await running;
    expect(log.events.some((e) => e.type === 'session.ended')).toBe(false);
  });

  it('stop() during the final cards leaves the session open', async () => {
    let engine!: SessionEngine;
    setCaller(async (c) => ({ ok: false, reason: 'provider_error', detail: 'offline test', log: { pass: c.pass } as never }));
    const log = new MemLog();
    await log.append([
      { eventId: `${sid}:start`, sessionId: sid, type: 'session.started', actor: 'operator', mediaMs: 0, wallTs: w, payload: { title: 'T', format: 'open', participants: [{ key: 'A', displayName: 'Ann', role: 'debater' }] } },
      utt('u1', 'A', 0, 'Only claim.'),
    ]);
    // The host's key is refused while the final insight pass runs.
    engine = new SessionEngine({ sessionId: sid, log, pollMs: 5, silenceMs: 0, say: (line) => { if (line.startsWith('insight #')) engine.stop(); } });
    engine.finishSource();
    await engine.run();
    expect(log.events.some((e) => e.type === 'session.ended')).toBe(false);
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

  it('resumes after a reload: the last closed turn is not re-extracted when its L1 output is already in the log', async () => {
    const extracted: string[] = [];
    setCaller(async (c) => { if (c.pass === 'L1_extract') extracted.push(c.input); return { ok: false, reason: 'provider_error', detail: 'offline test', log: { pass: c.pass } as never }; });
    const log = new MemLog();
    const closed = (n: number, who: string, u: string): DomainEvent => ({ eventId: `${sid}:t000${n}:closed`, sessionId: sid, type: 'turn.closed', actor: 'system', mediaMs: 0, wallTs: w, payload: { turnId: `${sid}:t000${n}`, participantKey: who, utteranceIds: [u] } });
    const adu = { id: `${sid}:t0001:a1`, speakerKey: 'B', spans: [], speechAct: 'assert', addressedTo: 'none' };
    await log.append([
      { eventId: `${sid}:start`, sessionId: sid, type: 'session.started', actor: 'operator', mediaMs: 0, wallTs: w, payload: { title: 'T', format: 'open', participants: [{ key: 'A', displayName: 'Ann', role: 'debater' }, { key: 'B', displayName: 'Bo', role: 'debater' }] } },
      utt('u1', 'A', 0, 'First claim about taxes.'),
      utt('u2', 'B', 3000, 'Second claim about spending.'),
      utt('u3', 'A', 6000, 'Third claim about growth.'),
      closed(0, 'A', 'u1'),
      closed(1, 'B', 'u2'),
      // The previous run got as far as L1 for t0001; re-running it would produce different content under the same ids.
      { eventId: `${adu.id}:proposed`, sessionId: sid, type: 'adu.proposed', actor: 'system', mediaMs: 5000, wallTs: w, payload: { adu } } as DomainEvent,
    ]);
    const engine = new SessionEngine({ sessionId: sid, log, pollMs: 5, silenceMs: 1 });
    engine.finishSource();
    await engine.run();
    expect(extracted).toHaveLength(1);
    expect(extracted[0]).toContain('Third claim');
  });

  it('resumes after a reload: new insight passes get fresh ids, so the log keeps them', async () => {
    const passes: string[] = [];
    setCaller(async (c) => { passes.push(c.pass); return { ok: false, reason: 'provider_error', detail: 'offline test', log: { pass: c.pass } as never }; });
    const log = new MemLog();
    const closed = (n: number, who: string, u: string): DomainEvent => ({ eventId: `${sid}:t000${n}:closed`, sessionId: sid, type: 'turn.closed', actor: 'system', mediaMs: 0, wallTs: w, payload: { turnId: `${sid}:t000${n}`, participantKey: who, utteranceIds: [u] } });
    const prop = { id: 'p1', canonical: 'Taxes should fall.', type: 'prescriptive', stratum: 'praxis', scope: { quantifier: 'generic' }, conditions: [], quantities: [], aboutConcepts: [], status: 'live_provisional' };
    const card = { id: `${sid}:l4:000:shared`, kind: 'shared', body: { ends: ['gone'], facts: [], framings: [], converging: [] }, refs: [] };
    await log.append([
      { eventId: `${sid}:start`, sessionId: sid, type: 'session.started', actor: 'operator', mediaMs: 0, wallTs: w, payload: { title: 'T', format: 'open', participants: [{ key: 'A', displayName: 'Ann', role: 'debater' }, { key: 'B', displayName: 'Bo', role: 'debater' }] } },
      utt('u1', 'A', 0, 'First claim about taxes.'),
      utt('u2', 'B', 3000, 'Second claim about spending.'),
      utt('u3', 'A', 6000, 'Third claim about growth.'),
      closed(0, 'A', 'u1'),
      { eventId: 'p1:proposed', sessionId: sid, type: 'proposition.proposed', actor: 'system', mediaMs: 2000, wallTs: w, payload: { proposition: prop } } as DomainEvent,
      { eventId: 'p1:auto-approved', sessionId: sid, type: 'item.approved', actor: 'system', mediaMs: 2000, wallTs: w, payload: { itemId: 'p1', note: 'test' } },
      { eventId: 'p2:proposed', sessionId: sid, type: 'proposition.proposed', actor: 'system', mediaMs: 2000, wallTs: w, payload: { proposition: { ...prop, id: 'p2', canonical: 'Spending should rise.' } } } as DomainEvent,
      { eventId: 'p2:auto-approved', sessionId: sid, type: 'item.approved', actor: 'system', mediaMs: 2000, wallTs: w, payload: { itemId: 'p2', note: 'test' } },
      // The previous run's insight pass #0.
      { eventId: `${card.id}:proposed`, sessionId: sid, type: 'insight.proposed', actor: 'system', mediaMs: 2000, wallTs: w, payload: { insight: card } } as DomainEvent,
      { eventId: `${card.id}:approved`, sessionId: sid, type: 'item.approved', actor: 'system', mediaMs: 2000, wallTs: w, payload: { itemId: card.id, note: 'test' } },
      closed(1, 'B', 'u2'),
    ]);
    const before = new Set(log.events.map((e) => e.eventId));
    const engine = new SessionEngine({ sessionId: sid, log, pollMs: 5, silenceMs: 1 });
    engine.finishSource();
    await engine.run();
    const fresh = log.events.filter((e) => e.type === 'insight.proposed' && !before.has(e.eventId));
    expect(fresh.map((e) => e.eventId)).toEqual([`${sid}:l4:001:shared:proposed`]);
    // p1 and p2 were already linked by the earlier pass: L3 is not asked again.
    expect(passes).not.toContain('L3_link');
  });

  it('resumes after a reload: an unchanged shared card is not re-emitted', async () => {
    setCaller(async (c) => ({ ok: false, reason: 'provider_error', detail: 'offline test', log: { pass: c.pass } as never }));
    const log = new MemLog();
    const prop = { id: 'p1', canonical: 'Taxes should fall.', type: 'prescriptive', stratum: 'praxis', scope: { quantifier: 'generic' }, conditions: [], quantities: [], aboutConcepts: [], status: 'live_provisional' };
    const card = { id: `${sid}:l4:000:shared`, kind: 'shared', body: { ends: [], facts: [], framings: [], converging: [] }, refs: [] };
    await log.append([
      { eventId: `${sid}:start`, sessionId: sid, type: 'session.started', actor: 'operator', mediaMs: 0, wallTs: w, payload: { title: 'T', format: 'open', participants: [{ key: 'A', displayName: 'Ann', role: 'debater' }, { key: 'B', displayName: 'Bo', role: 'debater' }] } },
      utt('u1', 'A', 0, 'First claim about taxes.'),
      { eventId: 'p1:proposed', sessionId: sid, type: 'proposition.proposed', actor: 'system', mediaMs: 2000, wallTs: w, payload: { proposition: prop } } as DomainEvent,
      { eventId: 'p1:auto-approved', sessionId: sid, type: 'item.approved', actor: 'system', mediaMs: 2000, wallTs: w, payload: { itemId: 'p1', note: 'test' } },
      { eventId: `${card.id}:proposed`, sessionId: sid, type: 'insight.proposed', actor: 'system', mediaMs: 2000, wallTs: w, payload: { insight: card } } as DomainEvent,
    ]);
    const before = new Set(log.events.map((e) => e.eventId));
    const engine = new SessionEngine({ sessionId: sid, log, pollMs: 5, silenceMs: 1 });
    engine.finishSource();
    await engine.run();
    expect(log.events.filter((e) => e.type === 'insight.proposed' && !before.has(e.eventId))).toEqual([]);
  });
});
