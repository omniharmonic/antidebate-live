/** Offline integration tests: real engine/passes/reducers, scripted model responses only. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Do not even load a paid provider transport in this suite.
vi.mock('@adl/llm', () => import('../../llm/src/core'));
import { setCaller, type LlmCallLog, type StructuredCall } from '@adl/llm';
import { project, audienceView, type DomainEvent } from '@adl/core';
import { validateSpan } from '../../ontology/src/index';
import type { z } from 'zod';
import { SessionEngine } from './engine';
import type { EventLog } from './types';

const sid = 'mock-audit';
const wallTs = '2026-09-30T00:00:00.000Z';
const pid = `${sid}:t0000:p1`;
const textA = 'Independent audits should be required.';
const textB = 'Independent audits should be voluntary.';
class MemoryLog implements EventLog {
  readonly kind = 'http' as const;
  readonly where = 'offline mock';
  events: DomainEvent[] = [];
  calls: LlmCallLog[] = [];
  async append(events: DomainEvent[]) { for (const e of events) if (!this.events.some(x => x.eventId === e.eventId)) this.events.push(structuredClone(e)); }
  async read(cursor: number) { return { cursor: this.events.length, events: this.events.slice(cursor) }; }
  async logCall(log: LlmCallLog) { this.calls.push(log); }
}
const envelope = { sessionId: sid, actor: 'fixture' as const, wallTs };
async function source(twoSpeakers = true) {
  const log = new MemoryLog();
  await log.append([{ ...envelope, eventId: 'start', mediaMs: 0, type: 'session.started', payload: {
    title: 'Mock audit policy dialogue', format: 'open', participants: [{ key: 'A', displayName: 'Ada', role: 'debater' }, { key: 'B', displayName: 'Ben', role: 'debater' }],
  } }]);
  for (const [index, text] of (twoSpeakers ? [textA, textB] : [textA]).entries()) {
    const startMs = index * 4000;
    await log.append([{ ...envelope, eventId: `u${index}`, mediaMs: startMs + 3000, type: 'utterance.final', payload: { utterance: {
      id: `u${index}`, participantKey: index ? 'B' : 'A', text, startMs, endMs: startMs + 3000, words: [], overlapsWith: [], attribution: { confidence: 1, signals: {}, confirmedBy: 'fixture' },
    } } }]);
  }
  return log;
}
const extraction = (speaker: string, quote: string) => ({
  adus: [{ ref: 'd1', quotes: [quote], speechAct: 'assert', addressedTo: 'none' }],
  propositions: [{ ref: 'p1', sameAs: null, canonical: quote, type: 'prescriptive', stratum: 'praxis', quantifier: 'generic', domain: null, timeHorizon: null, conditions: [] }],
  stances: [{ aduRef: 'd1', propositionRef: 'p1', participantKey: speaker, attitude: 'accepts', strength: 'confident', credence: null }],
  relations: [], bases: [], questions: [],
});
function callLog(c: StructuredCall<z.ZodType>): LlmCallLog {
  return { pass: c.pass, promptVersion: c.promptVersion, model: 'offline-scripted-response', effort: 'none', provider: 'cache', cached: true, inputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0, latencyMs: 0, stopReason: 'end_turn', billedUsd: 0, sessionId: sid };
}
interface Faults { extraction?: 'malformed' | 'provider' | 'quote' | 'reported' | 'empty'; critic?: 'missing' | 'duplicate' | 'invented' | 'empty-repair' | 'provider'; review?: 'reject' | 'provider' | 'malformed' }
function mock(faults: Faults = {}) {
  const seen: string[] = [];
  setCaller(async c => {
    seen.push(c.promptVersion);
    const log = callLog(c);
    const success = (data: unknown) => ({ ok: true as const, data, log });
    const fail = () => ({ ok: false as const, reason: 'provider_error' as const, detail: 'simulated connection failure', log });
    if (c.pass === 'L1_extract') {
      if (faults.extraction === 'provider') return fail();
      if (faults.extraction === 'malformed') return success({ adus: 'invalid' });
      if (faults.extraction === 'empty') return success({ adus: [], propositions: [], stances: [], relations: [], bases: [], questions: [] });
      const speaker = c.input.includes('TURN TO EXTRACT — speaker B') ? 'B' : 'A';
      const out = extraction(speaker, speaker === 'A' ? textA : textB);
      if (faults.extraction === 'quote') out.adus[0]!.quotes = ['Nobody uttered these words.'];
      if (faults.extraction === 'reported') out.adus[0]!.speechAct = 'steelman_report';
      return success(out);
    }
    if (c.promptVersion.startsWith('l2-critic')) {
      if (faults.critic === 'provider') return fail();
      const ids = [...c.input.matchAll(/ITEM \d+ · id ([^\n]+)/g)].map(m => m[1]!);
      const verdicts = ids.map(itemId => ({ itemId, verdict: 'pass', rule: 'ok', reason: 'Scripted faithful claim', repairedCanonical: null as string | null, repairedStrength: null }));
      if (faults.critic === 'missing') verdicts.pop();
      if (faults.critic === 'duplicate') verdicts.push({ ...verdicts[0]! });
      if (faults.critic === 'invented') verdicts.push({ ...verdicts[0]!, itemId: 'unrelated', verdict: 'repair', repairedCanonical: 'Corrupted by an unrelated critic response.' });
      if (faults.critic === 'empty-repair') verdicts[0]!.verdict = 'repair';
      return success({ verdicts });
    }
    if (c.pass === 'L3_link') return success({ merges: [], relations: [{ type: 'rebuts', fromId: `${sid}:t0001:p1`, toId: pid, reason: 'Voluntary and required audits are opposing policies.' }] });
    if (c.promptVersion === 'map-faithfulness-v1') {
      if (faults.review === 'provider') return fail();
      if (faults.review === 'malformed') return success({ verdicts: 'broken' });
      const input = JSON.parse(c.input) as { items: { id: string }[] };
      return success({ verdicts: input.items.map(item => ({ id: item.id, verdict: faults.review === 'reject' ? 'reject' : 'pass', reason: 'Scripted review decision' })) });
    }
    if (c.pass === 'L4_insight') return success({ crux: {
      propositionId: pid, updateConditions: [{ participantKey: 'A', wouldUpdateIf: 'not stated' }, { participantKey: 'B', wouldUpdateIf: 'not stated' }], settlingEvidence: 'empirical', valuesCrux: false,
    }, higherGround: [{ text: 'Independent audits are useful; whether to require them remains open.', construction: 'incompletely_theorized_agreement', derivation: [{ participantKey: 'A', propositionIds: [pid] }, { participantKey: 'B', propositionIds: [`${sid}:t0001:p1`] }], costs: [{ participantKey: 'A', gives: 'nothing' }, { participantKey: 'B', gives: 'nothing' }] }], prompts: [{ text: 'What would make an audit credible to each of you?', addresseeKey: 'both', kind: 'crux_probe', rationale: 'Clarify the practical difference.', targets: [pid] }] });
    throw new Error(`Unscripted mock call: ${c.promptVersion}`);
  });
  return seen;
}
async function run(log: MemoryLog) {
  const messages: string[] = [];
  const engine = new SessionEngine({ sessionId: sid, log, pollMs: 1, insightEveryTurns: 100, insightEveryMs: 1e9, say: line => messages.push(line) });
  engine.finishSource(); await engine.run();
  return { state: project(sid, log.events), messages };
}
beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden in mock pipeline tests'); })));
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe('scripted responses through the real analysis engine', () => {
  it('runs extraction → criticism → linking → synthesis with exact quotes, zero cost, and no audience auto-release', async () => {
    const seen = mock(); const log = await source(); const { state, messages } = await run(log);
    expect(messages.filter(x => /failed|Unscripted/.test(x))).toEqual([]);
    expect([...state.propositions.values()].filter(p => p.state === 'approved')).toHaveLength(2);
    expect([...state.relations.values()].filter(r => r.state === 'approved')).toHaveLength(1);
    expect([...state.insights.values()].filter(i => i.state === 'approved').map(i => i.value.kind)).toEqual(['crux', 'higher_ground', 'prompt', 'shared']);
    for (const adu of state.adus.values()) for (const span of adu.value.spans) expect(validateSpan(span, state.utterances)).toEqual([]);
    expect(seen).toContain('l3-link-v0.4'); expect(seen.filter(v => v === 'map-faithfulness-v1')).toHaveLength(2);
    expect(log.calls.every(c => c.model === 'offline-scripted-response' && c.billedUsd === 0)).toBe(true);
    state.channels.phones.level = 5; state.channels.phones.toggles.higher_ground = true;
    expect(audienceView(state, 'phones').insights).toEqual([]);
    expect(new Set(log.events.map(e => e.eventId)).size).toBe(log.events.length);
  });
  it.each(['malformed', 'provider'] as const)('holds %s extraction failures and completes them on retry', async extractionFault => {
    mock({ extraction: extractionFault }); const log = await source(false); const first = await run(log);
    expect(first.state.propositions.size).toBe(0);
    expect(log.events.some(e => e.type === 'analysis.completed' && e.payload.stage === 'L2')).toBe(false);
    const seen = mock(); const next = await run(log);
    expect(next.state.propositions.get(pid)?.state).toBe('approved'); expect(seen).toContain('l1-extract-v0.5');
  });
  it.each(['quote', 'reported'] as const)('hard validators override a permissive critic for %s extraction', async extractionFault => {
    mock({ extraction: extractionFault }); const { state } = await run(await source(false));
    expect([...state.propositions.values()].filter(p => p.state === 'approved')).toEqual([]);
    expect([...state.stances.values()].filter(s => s.state === 'approved')).toEqual([]);
  });
  it.each(['missing', 'duplicate', 'invented', 'empty-repair', 'provider'] as const)('holds %s critic responses without finalizing or losing saved extraction', async criticFault => {
    mock({ critic: criticFault }); const log = await source(false); const first = await run(log);
    expect(first.state.propositions.get(pid)?.state).toBe('proposed');
    expect(log.events.some(e => e.type === 'analysis.completed' && e.payload.stage === 'L2')).toBe(false);
    expect(log.events.some(e => e.type === 'item.edited')).toBe(false);
    const seen = mock(); const next = await run(log);
    expect(seen).not.toContain('l1-extract-v0.5'); expect(next.state.propositions.get(pid)?.state).toBe('approved');
  });
  it('checkpoints empty extraction so filler is not repeatedly sent for analysis after a reload', async () => {
    mock({ extraction: 'empty' }); const log = await source(false); await run(log);
    expect(log.events.filter(e => e.type === 'analysis.completed').map(e => e.payload.stage)).toEqual(['L1', 'L2']);
    const seen = mock(); await run(log); expect(seen).not.toContain('l1-extract-v0.5');
  });
  it.each([false, true])('recovers when saving extraction fails (write reached storage: %s)', async wrote => {
    mock(); const log = await source(false); const append = log.append.bind(log); let failed = false;
    log.append = async events => {
      if (!failed && events.some(e => e.type === 'adu.proposed')) {
        failed = true; if (wrote) await append(events);
        throw new Error('simulated interrupted event write');
      }
      await append(events);
    };
    const first = await run(log); expect(first.messages.some(m => m.includes('simulated interrupted event write'))).toBe(true);
    expect(log.events.some(e => e.type === 'item.approved' && e.payload.itemId === pid)).toBe(false);
    const seen = mock(); const next = await run(log);
    expect(seen.includes('l1-extract-v0.5')).toBe(!wrote);
    expect(next.state.propositions.get(pid)?.state).toBe('approved');
    expect(log.events.filter(e => e.type === 'proposition.proposed')).toHaveLength(1);
  });
  it.each(['reject', 'provider', 'malformed'] as const)('does not approve inferred links or generated cards after %s independent review', async reviewFault => {
    mock({ review: reviewFault }); const { state } = await run(await source());
    expect([...state.relations.values()].filter(r => r.state === 'approved')).toEqual([]);
    expect([...state.insights.values()].filter(i => i.state === 'approved' && i.value.kind !== 'shared')).toEqual([]);
  });
});
