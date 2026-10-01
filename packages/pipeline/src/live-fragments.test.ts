import { describe, expect, it } from 'vitest';
import { validateSpan, type Utterance } from '@adl/ontology';
import { mapL1Output, type L1Context } from './l1';
import { approvalEvents } from './l2';
import type { L1Output } from './prompts/l1-extract';
import { locateQuoteSpans } from './quotes';

const utterances = (texts: string[]): Utterance[] => texts.map((text, i) => ({
  id: `u${i}`, participantKey: 'A', startMs: i * 3000, endMs: (i + 1) * 3000,
  text, words: [], attribution: { confidence: 1, signals: {}, confirmedBy: 'operator' }, overlapsWith: [],
}));
function extract(texts: string[], quote: string) {
  const us = utterances(texts);
  const turn = { turnId: 's:t0000', participantKey: 'A', utterances: us, startMs: 0, endMs: us.at(-1)!.endMs, text: texts.join(' ') };
  const ctx: L1Context = { sessionId: 's', participants: [{ key: 'A', displayName: 'A' }], round: null, recentTurns: [], propositionIndex: [], utterances: new Map(us.map(u => [u.id, u])), wallTs: () => '2026-09-30T20:00:00.000Z' };
  const out: L1Output = {
    adus: [{ ref: 'a1', quotes: [quote], speechAct: 'assert', addressedTo: 'audience' }],
    propositions: [{ ref: 'p1', sameAs: null, canonical: 'Work should be funded through taxation.', type: 'prescriptive', stratum: 'praxis', quantifier: 'generic', domain: null, timeHorizon: null, conditions: [] }],
    stances: [{ aduRef: 'a1', propositionRef: 'p1', participantKey: 'A', attitude: 'accepts', strength: 'leaning', credence: null }], relations: [], bases: [], questions: [],
  };
  return { events: mapL1Output(turn, out, ctx), us, ctx, turn };
}

describe('live claims spanning transcript fragments', () => {
  it('preserves a claim and hedge across three exact transcript chunks through approval', () => {
    const { events, ctx, turn } = extract(['And I think that', 'We should probably', 'fund that through taxation.'], 'I think that We should probably fund that through taxation.');
    const adu = events.find(e => e.type === 'adu.proposed');
    expect(adu?.payload.adu.spans).toHaveLength(3);
    if (adu?.type !== 'adu.proposed') throw new Error('Missing quote-backed ADU');
    for (const span of adu.payload.adu.spans) expect(validateSpan(span, ctx.utterances)).toEqual([]);
    expect(adu.payload.adu.spans.map(s => s.quote)).toEqual(['I think that', 'We should probably', 'fund that through taxation.']);
    expect(events.filter(e => e.type === 'stance.proposed')).toHaveLength(1);
    const approved = approvalEvents(turn, events, [{ itemId: 's:t0000:p1', verdict: 'pass', rule: 'ok', reason: 'ok', repairedCanonical: null, repairedStrength: null }], new Set(), { sessionId: 's', wallTs: ctx.wallTs() });
    expect(approved.some(e => e.type === 'item.approved' && e.payload.itemId === 's:t0000:p1')).toBe(true);
  });
  it('does not repair punctuation, casing, skipped words or paraphrases', () => {
    const texts = ['I believe that everyone should have', 'Solid pay for dignified work.'];
    for (const quote of ['I believe that everyone should have solid pay for dignified work.', 'everyone should have Solid pay for work.', 'everyone deserves Solid pay for dignified work.']) {
      const { events } = extract(texts, quote);
      expect(events.some(e => e.type === 'adu.proposed')).toBe(false);
      expect(events.some(e => e.type === 'stance.proposed')).toBe(false);
      const failure = events.find(e => e.type === 'validation.result');
      expect(failure?.payload.issues[0]?.message).toContain(JSON.stringify(quote));
    }
  });
  it('anchors an exact quote across a two-chunk boundary without altering capitalization', () => {
    const { events } = extract(['I believe that everyone should have', 'Solid pay for dignified work.'], 'everyone should have Solid pay for dignified work.');
    const adu = events.find(e => e.type === 'adu.proposed');
    expect(adu?.payload.adu.spans.map(s => s.quote)).toEqual(['everyone should have', 'Solid pay for dignified work.']);
  });
  it('does not join different speakers into one quote', () => {
    const us = utterances(['We should', 'fund that through taxation.']);
    us[1]!.participantKey = 'B';
    expect(locateQuoteSpans('We should fund that through taxation.', us)).toBeNull();
  });
});
