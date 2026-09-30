import { expect, it } from 'vitest';
import type { DomainEvent } from '@adl/core';
import { approvalEvents } from './l2';
import type { Turn } from './turns';
it('a critic repair cannot inflate a rhetorical question beyond the ontology cap', () => {
  const l1 = [
    { type: 'adu.proposed', payload: { adu: { id: 'a', speakerKey: 'A', spans: [{ utteranceId: 'u', charStart: 0, charEnd: 12, quote: 'Why not ask?' }], speechAct: 'rhetorical_question', addressedTo: 'none' } } },
    { type: 'proposition.proposed', payload: { proposition: { id: 'p' } } },
    { type: 'stance.proposed', payload: { stance: { id: 's', participantKey: 'A', propositionId: 'p', viaAduId: 'a', atMs: 0, attitude: 'accepts', strength: 'leaning', source: 'implied_by_act' } } },
  ] as DomainEvent[];
  const out = approvalEvents({ endMs: 1000 } as Turn, l1, [{ itemId: 'p', verdict: 'repair', rule: 'hedge', reason: 'Plain statement', repairedCanonical: null, repairedStrength: 'confident' }], new Set(), { sessionId: 'test', wallTs: 'x' });
  expect(out.some((e) => e.type === 'item.approved' && e.payload.itemId === 's')).toBe(true);
  expect(out.some((e) => e.type === 'item.edited')).toBe(false);
});
