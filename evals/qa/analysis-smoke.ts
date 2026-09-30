/** Small authored regression probe, not the adjudicated G1–G4 release evaluation.
 * LLM_PROVIDER=api LLM_API_BUDGET_USD=<ledger ceiling> pnpm exec tsx evals/qa/analysis-smoke.ts
 * Uses the configured models/effort unchanged. Requires the normal provider credentials.
 */
import { writeFileSync } from 'node:fs';
import { runL1 } from '../../packages/pipeline/src/l1';
import { runL2, approvalEvents } from '../../packages/pipeline/src/l2';
import { project, type DomainEvent } from '../../packages/core/src/index';
import type { Utterance } from '../../packages/ontology/src/index';

const cases = [
  { id: 'attribute', text: 'Bo says that all frontier AI research should stop. I am describing his position, not endorsing it.', expected: 'The reported total stop is not an acceptance by Ann.' },
  { id: 'steelman', text: 'Let me steelman Bo: open models give dangerous actors capabilities that safeguards cannot contain. That is his strongest argument; I have not adopted it.', expected: 'Steelmanned content never enters Ann’s commitments.' },
  { id: 'hypothetical', text: 'Suppose licensing worked perfectly. In that imagined world we might prevent misuse. I am not saying licensing actually works.', expected: 'The hypothetical effectiveness is not an actual commitment.' },
  { id: 'rhetorical', text: 'Who has time to fact-check everything anybody says? We do not.', expected: 'If classified rhetorical_question, implied_by_act and at most leaning; an explicit answer may be a separate assertion.' },
  { id: 'hedge-range', text: 'I am not sure, but maybe twenty to thirty percent of these systems could fail under that stress test.', expected: 'Tentative conditional prediction; no confident estimate or single-point percentage.' },
  { id: 'scope-negation', text: 'Not all regulation is bad. Some rules prevent clear harms, but that does not mean all AI research should be licensed.', expected: 'Preserve some/not-all scope, and do not turn rejection of universal licensing into endorsement.' },
];
const reports = [];
for (const c of cases) {
  const sessionId = `qa-${c.id}`;
  const utterance: Utterance = { id: 'u1', participantKey: 'A', startMs: 0, endMs: 12000, text: c.text, words: [], attribution: { confidence: 1, confirmedBy: 'operator', signals: {} }, overlapsWith: [] };
  const participants = [{ key: 'A', displayName: 'Ann', role: 'debater' as const }, { key: 'B', displayName: 'Bo', role: 'debater' as const }];
  const turn = { turnId: `${sessionId}:t0000`, participantKey: 'A', utterances: [utterance], startMs: 0, endMs: 12000, text: c.text };
  const wallTs = () => new Date().toISOString();
  const l1 = await runL1(turn, { sessionId, participants, round: null, recentTurns: [], propositionIndex: [], utterances: new Map([['u1', utterance]]), wallTs });
  const index = new Map(l1.events.flatMap((e) => e.type === 'proposition.proposed' ? [[e.payload.proposition.id, e.payload.proposition.canonical] as const] : []));
  const l2 = await runL2(turn, l1.events, { sessionId, participants, recentTurns: [], index, wallTs });
  const events: DomainEvent[] = [
    { eventId: 'start', sessionId, type: 'session.started', actor: 'operator', mediaMs: 0, wallTs: wallTs(), payload: { title: c.id, format: 'open', participants } },
    { eventId: 'u1', sessionId, type: 'utterance.final', actor: 'system', mediaMs: 12000, wallTs: wallTs(), payload: { utterance } },
    ...l1.events, ...l2.events, ...approvalEvents(turn, l1.events, l2.verdicts, new Set(), { sessionId, wallTs: wallTs() }),
  ];
  const state = project(sessionId, events);
  reports.push({ ...c, errors: [l1.error, l2.error].filter(Boolean), calls: [l1.log, l2.log].filter(Boolean),
    stances: [...state.stances.values()].map((s) => ({ state: s.state, ...s.value, proposition: state.propositions.get(s.value.propositionId)?.value, adu: s.value.viaAduId ? state.adus.get(s.value.viaAduId)?.value : null })) });
  console.log(`${c.id}: ${l1.error ?? l2.error ?? 'completed'}`);
  writeFileSync('.data/qa-analysis-smoke.json', JSON.stringify(reports, null, 2));
}
