import { expect, it } from 'vitest';
import { insightCards, type L4Output } from './l4';
import type { MapView } from './mapview';
const stance = (id: string, key: string, pid: string) => ({ id, participantKey: key, propositionId: pid, atMs: 0, attitude: 'accepts' as const, strength: 'confident' as const, source: 'stated' as const });
const view = (): MapView => ({
  debaters: [{ key: 'A', displayName: 'Alex Brown' }, { key: 'B', displayName: 'Alex Green' }],
  props: new Map([['p1', { id: 'p1', canonical: 'A claim' }], ['p2', { id: 'p2', canonical: 'A different claim' }]]),
  holders: new Map([['p1', new Map([['A', stance('s1', 'A', 'p1')]])], ['p2', new Map([['B', stance('s2', 'B', 'p2')]])]]),
  quotes: new Map([['s1', 'I think this.'], ['s2', 'That does not follow.']]),
  stances: [], relations: [], disagreements: [], clashes: [], commonGround: [], convergences: [], cruxCandidates: [],
} as unknown as MapView);
const output = (): L4Output => ({ crux: null, prompts: [], higherGround: [{ text: 'A candidate worth testing.', construction: 'value_lift', derivation: [{ participantKey: 'A', propositionIds: ['p1'] }, { participantKey: 'B', propositionIds: ['p2'] }], costs: [{ participantKey: 'A', gives: 'nothing' }, { participantKey: 'B', gives: 'nothing' }] }] });
it('rejects a whole synthesis when any cited commitment is invalid instead of silently stripping evidence', () => {
  const out = output();
  expect(insightCards(out, view()).higherGround).toHaveLength(1);
  out.higherGround[0]!.derivation[0]!.propositionIds.push('invented');
  expect(insightCards(out, view()).higherGround).toEqual([]);
});
it('requires commitments and costs from every debater and at least two debaters', () => {
  const out = output();
  out.higherGround[0]!.costs.pop();
  expect(insightCards(out, view()).higherGround).toEqual([]);
  const v = view(); v.debaters.pop();
  expect(insightCards(output(), v).higherGround).toEqual([]);
});
it('does not guess ambiguous names or silently retarget an ungrounded question', () => {
  const out = output();
  out.prompts = [{ text: 'What would change your mind?', addresseeKey: 'Alex', kind: 'crux_probe', rationale: '', targets: ['p1'] }];
  expect(insightCards(out, view()).prompts).toEqual([]);
  out.prompts[0]!.addresseeKey = 'A'; out.prompts[0]!.targets.push('invented');
  expect(insightCards(out, view()).prompts).toEqual([]);
});
it('an undercut preserves the stance on its own premise instead of inventing rejection of the conclusion', () => {
  const v = view();
  v.relations = [{ id: 'r', fromId: 'p2', toId: 'p1', type: 'undercuts', inferred: false }] as MapView['relations'];
  v.cruxCandidates = [{ propositionId: 'p1', score: 1, forDisagreements: [], basis: 'clash', lastEngagedMs: 0 }];
  const out = output(); out.crux = { propositionId: 'p1', updateConditions: [], settlingEvidence: 'empirical', valuesCrux: false };
  expect(insightCards(out, v).crux?.sides[1]).toMatchObject({ participantKey: 'B', attitude: 'accepts', stanceId: 's2', via: { propositionId: 'p2', relation: 'undercuts' } });
});
it('does not publish a guessed update condition without a same-speaker exact quote', () => {
 const v=view(); v.holders.get('p1')!.set('B', { ...stance('s3','B','p1'), attitude: 'rejects' }); v.cruxCandidates=[{propositionId:'p1',score:1,forDisagreements:[],basis:'stated',lastEngagedMs:0}];
 const out=output();out.crux={propositionId:'p1',updateConditions:[{participantKey:'A',wouldUpdateIf:'A might update after a global treaty.'}],settlingEvidence:'empirical',valuesCrux:false};
 expect(insightCards(out,v).crux?.updateConditions.A).toBe('not stated');
});
