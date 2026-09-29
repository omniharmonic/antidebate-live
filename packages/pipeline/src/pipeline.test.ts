import { describe, expect, it } from 'vitest';
import type { Utterance } from '@adl/ontology';
import { mapL1Output, type L1Context } from './l1';
import { locateQuote } from './quotes';
import { TurnBuffer } from './turns';

const utt = (id: string, key: string, startMs: number, endMs: number, text: string): Utterance => ({
  id,
  participantKey: key,
  startMs,
  endMs,
  text,
  words: [],
  attribution: { confidence: 1, signals: {}, confirmedBy: 'fixture' },
  overlapsWith: [],
});

describe('TurnBuffer', () => {
  it('closes on speaker change', () => {
    const b = new TurnBuffer('s');
    expect(b.push(utt('1', 'A', 0, 1000, 'one two three'))).toEqual([]);
    const closed = b.push(utt('2', 'B', 1100, 2000, 'four'));
    expect(closed).toHaveLength(1);
    expect(closed[0]?.participantKey).toBe('A');
  });
  it('closes on a long pause after enough words', () => {
    const b = new TurnBuffer('s');
    b.push(utt('1', 'A', 0, 3000, 'one two three four five six seven eight'));
    expect(b.push(utt('2', 'A', 5000, 6000, 'nine'))).toHaveLength(1);
  });
  it('closes monologues at the window', () => {
    const b = new TurnBuffer('s');
    b.push(utt('1', 'A', 0, 10_000, 'a'));
    b.push(utt('2', 'A', 10_100, 20_000, 'b'));
    expect(b.push(utt('3', 'A', 20_100, 30_000, 'c'))).toHaveLength(1);
  });
});

describe('locateQuote', () => {
  it('finds exact quotes only', () => {
    const us = [utt('u1', 'A', 0, 1, 'Audits I am fine with.')];
    expect(locateQuote('Audits I am fine with', us)).toMatchObject({ charStart: 0, charEnd: 21 });
    expect(locateQuote('Audits are fine', us)).toBeNull();
  });
});

describe('mapL1Output', () => {
  const u = utt('u1', 'B', 0, 5000, "Look, audits I'm fine with. What I don't want is a licensing regime.");
  const turn = { turnId: 's:t0001', participantKey: 'B', utterances: [u], startMs: 0, endMs: 5000, text: u.text };
  const ctx: L1Context = {
    sessionId: 's',
    participants: [{ key: 'A', displayName: 'A' }, { key: 'B', displayName: 'B' }],
    round: 'Rebuttals',
    recentTurns: [],
    propositionIndex: [{ id: 'P9', canonical: 'Third-party auditing of frontier AI labs should be established.' }],
    utterances: new Map([[u.id, u]]),
    wallTs: () => '2026-10-11T21:00:00.000Z',
  };
  const out = {
    adus: [
      { ref: 'd1', quotes: ["audits I'm fine with"], speechAct: 'concede' as const, addressedTo: 'A' },
      { ref: 'd2', quotes: ["What I don't want is a licensing regime"], speechAct: 'assert' as const, addressedTo: 'none' },
      { ref: 'd3', quotes: ['a sentence that was never said'], speechAct: 'assert' as const, addressedTo: 'none' },
    ],
    propositions: [
      { ref: 'p1', sameAs: 'P9', canonical: '', type: 'prescriptive' as const, stratum: 'praxis' as const, quantifier: 'generic' as const, domain: null, timeHorizon: null, conditions: [] },
      { ref: 'p2', sameAs: null, canonical: 'A licensing regime should be established.', type: 'prescriptive' as const, stratum: 'praxis' as const, quantifier: 'generic' as const, domain: null, timeHorizon: null, conditions: [] },
    ],
    stances: [
      { aduRef: 'd1', propositionRef: 'p1', participantKey: 'B', attitude: 'accepts' as const, strength: 'confident' as const, credence: null },
      { aduRef: 'd2', propositionRef: 'p2', participantKey: 'B', attitude: 'rejects' as const, strength: 'confident' as const, credence: null },
    ],
    relations: [],
    bases: [],
    questions: [],
  };

  it('maps quotes to exact spans, resolves identity, marks concessions, drops unlocatable ADUs', () => {
    const events = mapL1Output(turn, out, ctx);
    const types = events.map((e) => e.type);
    expect(types.filter((t) => t === 'adu.proposed')).toHaveLength(2);
    expect(events.some((e) => e.type === 'validation.result' && e.payload.itemId.endsWith(':d3'))).toBe(true);
    const props = events.flatMap((e) => (e.type === 'proposition.proposed' ? [e.payload.proposition] : []));
    expect(props.map((p) => p.canonical)).toEqual(['A licensing regime should be established.']);
    const stances = events.flatMap((e) => (e.type === 'stance.proposed' ? [e.payload.stance] : []));
    expect(stances[0]).toMatchObject({ propositionId: 'P9', source: 'implied_by_act' });
    expect(stances[1]).toMatchObject({ attitude: 'rejects', source: 'stated' });
  });
});

describe('insightCards key resolution', () => {
  it('accepts display names where keys are expected', async () => {
    const { insightCards } = await import('./l4');
    const stance = (id: string, pid: string, key: string) => ({ id, participantKey: key, propositionId: pid, atMs: 0, attitude: 'accepts' as const, strength: 'confident' as const, source: 'stated' as const });
    const v = {
      debaters: [{ key: 'A', displayName: 'Shereef Bishay' }, { key: 'B', displayName: 'Layman Pascal' }],
      props: new Map(), stances: [], relations: [], disagreements: [], clashes: [], commonGround: [], cruxCandidates: [], quotes: new Map(),
      holders: new Map([['p1', new Map([['A', stance('s1', 'p1', 'A')]])], ['p2', new Map([['B', stance('s2', 'p2', 'B')]])]]),
    } as unknown as Parameters<typeof insightCards>[1];
    const out = insightCards(
      { crux: null, prompts: [{ text: 'Q?', addresseeKey: 'Layman', kind: 'open_question', rationale: '', targets: [] }], higherGround: [{ text: 'Both could sign this.', construction: 'value_lift', derivation: [{ participantKey: 'Shereef Bishay', propositionIds: ['p1'] }, { participantKey: 'Layman Pascal', propositionIds: ['p2'] }], costs: [{ participantKey: 'Shereef Bishay', gives: 'nothing' }] }] },
      v,
    );
    expect(out.higherGround).toHaveLength(1);
    expect(out.higherGround[0]!.derivation).toEqual({ A: ['p1'], B: ['p2'] });
    expect(out.prompts[0]!.addresseeKey).toBe('B');
  });
});

describe('crossSpeakerCandidates', () => {
  it('finds a paraphrase held by the other speaker, not by the same one', async () => {
    const { crossSpeakerCandidates } = await import('./mapview');
    const st = (k: string, pid: string) => ({ id: `s-${pid}-${k}`, participantKey: k, propositionId: pid, atMs: 0, attitude: 'accepts' as const, strength: 'confident' as const, source: 'stated' as const });
    const prop = (id: string, canonical: string) => [id, { id, canonical }] as const;
    const v = {
      props: new Map([prop('n', 'Independent auditors should verify frontier AI labs.'), prop('o', 'Frontier AI labs should be verified by independent auditors.'), prop('m', 'Independent auditors should check AI labs often.'), prop('x', 'Chip smuggling is widespread.')]),
      holders: new Map([['n', new Map([['A', st('A', 'n')]])], ['o', new Map([['B', st('B', 'o')]])], ['m', new Map([['A', st('A', 'm')]])], ['x', new Map([['B', st('B', 'x')]])]]),
    } as unknown as Parameters<typeof crossSpeakerCandidates>[0];
    const c = crossSpeakerCandidates(v, ['n']);
    expect(c.has('o')).toBe(true);
    expect(c.has('m')).toBe(false);
    expect(c.has('x')).toBe(false);
  });
});

describe('card stability', () => {
  it('drops a repeated crux and near-duplicate higher ground', async () => {
    const { stableCards } = await import('./l4');
    const hg = (text: string) => ({ text, construction: 'value_lift' as const, derivation: { A: ['p1'], B: ['p2'] }, costs: {}, reliesOnInferred: false });
    const crux = { propositionId: 'p9', statement: 'x', sides: [], updateConditions: {}, settlingEvidence: 'empirical' as const, valuesCrux: false, downstream: [], score: 1, basis: 'stated' as const } as never;
    const out = stableCards(
      { crux, higherGround: [hg('The hole left by the death of God is real and needs up-to-date practices.'), hg('Audits of labs should begin now.')], prompts: [] },
      { cruxPropositionId: 'p9', higherGround: ['The hole left by the death of God is real, and it needs up-to-date practices.'], prompts: [] },
    );
    expect(out.crux).toBeNull();
    expect(out.higherGround.map((h) => h.text)).toEqual(['Audits of labs should begin now.']);
  });
});

describe('round sequence guard', () => {
  it('never returns to an earlier phase; allows a within-phase step back only after 3 minutes', async () => {
    const { acceptRoundChange } = await import('./rounds');
    expect(acceptRoundChange('anti-debate', 'steelman', 36 * 60000, 'open_debate', 36.3 * 60000)).toBe(false);
    expect(acceptRoundChange('anti-debate', 'rebuttals', 26 * 60000, 'steelman', 36 * 60000)).toBe(true);
    expect(acceptRoundChange('anti-debate', 'openings', 9.6 * 60000, 'connection', 10 * 60000)).toBe(false);
    expect(acceptRoundChange('anti-debate', 'openings', 9.6 * 60000, 'connection', 14 * 60000)).toBe(true);
  });
});
