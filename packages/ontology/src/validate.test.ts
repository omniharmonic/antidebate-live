import { describe, expect, it } from 'vitest';
import type { Adu, Stance, Utterance } from './entities';
import {
  maxStrengthForSpan,
  narrowestQuantifier,
  validateHedge,
  validateNoNewContent,
  validateScope,
  validateSpan,
  validateSpeechActStance,
  validateAttribution,
  validateCommittingAct,
  validateRhetorical,
} from './validate';

const u: Utterance = {
  id: 'u1',
  participantKey: 'A',
  startMs: 0,
  endMs: 5000,
  text: "I think some labs will grade their own homework within three years.",
  words: [],
  attribution: { confidence: 0.97, signals: {}, confirmedBy: 'auto' },
  overlapsWith: [],
};
const utterances = new Map([[u.id, u]]);

describe('validateSpan', () => {
  it('accepts an exact quote', () => {
    expect(validateSpan({ utteranceId: 'u1', charStart: 8, charEnd: 17, quote: 'some labs' }, utterances)).toEqual([]);
  });
  it('rejects a paraphrased quote', () => {
    expect(validateSpan({ utteranceId: 'u1', charStart: 8, charEnd: 17, quote: 'the labs!' }, utterances)[0]?.code).toBe('span_quote_mismatch');
  });
  it('rejects out-of-range spans', () => {
    expect(validateSpan({ utteranceId: 'u1', charStart: 0, charEnd: 999, quote: 'x' }, utterances)[0]?.code).toBe('span_out_of_range');
  });
});

describe('hedges (§8.3)', () => {
  it('caps "I think" at leaning', () => {
    expect(maxStrengthForSpan(u.text)).toBe('leaning');
    expect(validateHedge(u.text, 'certain')[0]?.code).toBe('hedge_inflated');
    expect(validateHedge(u.text, 'leaning')).toEqual([]);
  });
  it('caps "maybe" at tentative', () => {
    expect(maxStrengthForSpan('Maybe 20, 30 percent.')).toBe('tentative');
  });
  it('allows certain when unhedged', () => {
    expect(maxStrengthForSpan('Licensing creates a chokepoint.')).toBe('certain');
  });
});

describe('scope (§8.4)', () => {
  it('finds the narrowest quantifier', () => {
    expect(narrowestQuantifier(u.text)).toBe('some');
  });
  it('rejects widening "some labs" to all/generic', () => {
    expect(validateScope(u.text, 'generic')[0]?.code).toBe('scope_widened');
    expect(validateScope(u.text, 'some')).toEqual([]);
  });
});

describe('no new content (§8.2)', () => {
  it('flags numbers and entities absent from the span', () => {
    const codes = validateNoNewContent('Frontier labs in California will self-evaluate by 2030.', [u.text]).map((i) => i.code);
    expect(codes).toContain('new_number');
    expect(codes).toContain('new_entity');
  });
  it('passes faithful canonical text', () => {
    expect(validateNoNewContent('Some labs will evaluate their own systems within three years.', [u.text])).toEqual([]);
  });
});

describe('speech-act guard (§8.5)', () => {
  const stance: Stance = { id: 's1', participantKey: 'A', propositionId: 'p1', atMs: 0, attitude: 'accepts', strength: 'leaning', source: 'stated' };
  const adu = (speechAct: Adu['speechAct']): Adu => ({ id: 'a1', speakerKey: 'A', spans: [{ utteranceId: 'u1', charStart: 0, charEnd: 7, quote: 'I think' }], speechAct, addressedTo: 'none' });
  it('blocks stances from steelman reports and attributions', () => {
    expect(validateSpeechActStance(adu('steelman_report'), stance)[0]?.code).toBe('non_attributable_stance');
    expect(validateSpeechActStance(adu('attribute'), stance)[0]?.code).toBe('non_attributable_stance');
  });
  it('allows assertions', () => {
    expect(validateSpeechActStance(adu('assert'), stance)).toEqual([]);
  });
});

describe('attribution hold', () => {
  it('holds low-confidence auto attributions', () => {
    const low = new Map([[u.id, { ...u, attribution: { ...u.attribution, confidence: 0.6 } }]]);
    expect(validateAttribution([{ utteranceId: 'u1', charStart: 0, charEnd: 7, quote: 'I think' }], low)[0]?.code).toBe('attribution_pending');
  });
});

// Regressions from the first live L1 run (evals/results.md 2026-09-28): each was a false positive.
describe('validator false positives from DT t0020–t0031', () => {
  it('does not read "one" as a number', () => {
    expect(validateNoNewContent('Whenever a person seeks one pole, the opposite pole is present.', ['seeking a pole, the opposite pole'])).toEqual([]);
  });
  it('still flags digits', () => {
    expect(validateNoNewContent('1 lab will self-evaluate.', ['a lab will'])[0]?.code).toBe('new_number');
  });
  it('ignores parenthetical and comparative hedge words', () => {
    expect(maxStrengthForSpan('to keep, you might say, the Soul of the World in equilibrium')).toBe('certain');
    expect(maxStrengthForSpan('an attacker is less likely unless she lives in anxiety')).toBe('certain');
    expect(maxStrengthForSpan('it might happen')).toBe('tentative');
  });
  it('ignores idioms and superlatives that contain quantifier words', () => {
    expect(narrowestQuantifier('this is in some ways akin to fundamentalism')).toBeNull();
    expect(narrowestQuantifier('absolute morality, which is the most primitive form')).toBeNull();
    expect(narrowestQuantifier('most labs will comply')).toBe('most');
  });
});

describe('commitment guard (§2.2)', () => {
  const stance: Stance = { id: 's1', participantKey: 'A', propositionId: 'p1', atMs: 0, attitude: 'accepts', strength: 'tentative', source: 'stated' };
  const adu = (speechAct: Adu['speechAct']): Adu => ({ id: 'a1', speakerKey: 'A', spans: [{ utteranceId: 'u1', charStart: 0, charEnd: 7, quote: 'I think' }], speechAct, addressedTo: 'none' });
  it('blocks speaker stances from questions, challenges and meta', () => {
    for (const act of ['question', 'challenge', 'meta'] as const) expect(validateCommittingAct(adu(act), stance)[0]?.code).toBe('non_committing_stance');
  });
  it('allows concessions and answers', () => {
    expect(validateCommittingAct(adu('concede'), stance)).toEqual([]);
    expect(validateCommittingAct(adu('answer'), stance)).toEqual([]);
  });
});

describe('rhetorical questions (§2.2)', () => {
  const adu: Adu = { id: 'a1', speakerKey: 'B', spans: [{ utteranceId: 'u1', charStart: 0, charEnd: 7, quote: 'Why wait?' }], speechAct: 'rhetorical_question', addressedTo: 'none' };
  const stance = (source: Stance['source'], strength: Stance['strength']): Stance => ({ id: 's', participantKey: 'B', propositionId: 'p', atMs: 0, attitude: 'accepts', strength, source });
  it('allows the implied statement at leaning or below', () => {
    expect(validateRhetorical(adu, stance('implied_by_act', 'leaning'))).toEqual([]);
    expect(validateRhetorical(adu, stance('implied_by_act', 'tentative'))).toEqual([]);
  });
  it('blocks stated or confident commitments', () => {
    expect(validateRhetorical(adu, stance('stated', 'leaning'))[0]?.code).toBe('rhetorical_overcommitted');
    expect(validateRhetorical(adu, stance('implied_by_act', 'confident'))[0]?.code).toBe('rhetorical_overcommitted');
  });
});
