import { expect, it } from 'vitest';
import { project, type DomainEvent } from '@adl/core';
import { structuralCorrections } from './retro-corrections';
const base = { sessionId: 's', wallTs: '2026-09-29T00:00:00Z', actor: 'fixture' as const, mediaMs: 1000 };
const events: DomainEvent[] = [
  { ...base, eventId: 'u', type: 'utterance.final', payload: { utterance: { id: 'u', participantKey: 'A', text: 'Why wait?', startMs: 0, endMs: 1000, words: [], overlapsWith: [], attribution: { confidence: 1, signals: {}, confirmedBy: 'fixture' } } } },
  { ...base, eventId: 'a:proposed', type: 'adu.proposed', payload: { adu: { id: 'a', speakerKey: 'A', speechAct: 'rhetorical_question', addressedTo: 'none', spans: [{ utteranceId: 'u', charStart: 0, charEnd: 9, quote: 'Why wait?' }] } } },
  { ...base, eventId: 'p:proposed', type: 'proposition.proposed', payload: { proposition: { id: 'p', canonical: 'Waiting is unnecessary.', type: 'prescriptive', stratum: 'praxis', scope: { quantifier: 'generic' }, conditions: [], quantities: [], aboutConcepts: [], status: 'live_provisional' } } },
  { ...base, eventId: 'st:proposed', type: 'stance.proposed', payload: { stance: { id: 'st', participantKey: 'A', propositionId: 'p', viaAduId: 'a', attitude: 'accepts', strength: 'confident', source: 'implied_by_act', atMs: 1000 } } },
  ...['a','p','st'].map(itemId => ({ ...base, eventId: `${itemId}:approved`, type: 'item.approved' as const, payload: { itemId } })),
  { ...base, eventId: 'crux:proposed', type: 'insight.proposed', payload: { insight: { id: 'crux', kind: 'crux', refs: ['p'], body: { propositionId: 'p', statement: 'Waiting is unnecessary.', sides: [{ participantKey: 'A', attitude: 'rejects', strength: 'confident', stanceId: 'st', quote: 'Why wait?', via: { propositionId: 'p', statement: 'Waiting is unnecessary.', relation: 'undercuts' } }], updateConditions: {}, settlingEvidence: 'empirical', valuesCrux: false, downstream: [], score: 1, basis: 'clash' } } } },
  { ...base, eventId: 'crux:approved', type: 'item.approved', payload: { itemId: 'crux' } },
];
it('corrects rhetorical strength and a copied crux side without rewriting any original event', () => {
  const original = structuredClone(events);
  const patch = structuralCorrections(events, '2026-09-30T00:00:00Z');
  expect(events).toEqual(original); expect(patch).toHaveLength(2);
  expect(patch.every(e => e.mediaMs === 1000 && e.wallTs === '2026-09-30T00:00:00Z')).toBe(true);
  const s = project('s', [...events, ...patch]);
  expect(s.stances.get('st')?.value.strength).toBe('leaning');
  expect(s.insights.get('crux')?.value.body.sides).toMatchObject([{ attitude: 'accepts', strength: 'leaning' }]);
  expect(structuralCorrections([...events, ...patch], '2026-10-01T00:00:00Z')).toEqual([]);
});
it('rejects unanchored stances and their unsupported propositions', () => {
  const broken = events.filter(e => e.type !== 'utterance.final');
  const patch = structuralCorrections(broken, '2026-09-30T00:00:00Z');
  const s = project('s', [...broken, ...patch]);
  expect(s.stances.get('st')?.state).toBe('rejected');
  expect(s.propositions.get('p')?.state).toBe('rejected');
  expect(structuralCorrections([...broken, ...patch], 'later')).toEqual([]);
});
