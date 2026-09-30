/** Structural checks on saved maps; this is NOT a human faithfulness/signability score.
 * pnpm exec tsx evals/qa/audit-maps.ts [.data/session.events.jsonl ...]
 */
import { readFileSync } from 'node:fs';
import { project, type DomainEvent } from '../../packages/core/src/index';
import { validateSpan, validateStance } from '../../packages/ontology/src/index';
import { buildMapView } from '../../packages/pipeline/src/mapview';
const defaults = ['ball-kokotajlo-r5', 'belief-in-god-r3', 'open-source-ai-r3', 'gender-affirming-care-r3', 'destiny-shermer-r3'].map((s) => `.data/${s}.events.jsonl`);
const files = process.argv.slice(2).length ? process.argv.slice(2) : defaults;
const results = files.map((file) => {
  const events = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as DomainEvent);
  const state = project(events[0]!.sessionId, events);
  const view = buildMapView(state);
  const active = (state: string) => state === 'approved' || state === 'released';
  const adus = [...state.adus.values()].filter((x) => active(x.state));
  const badSpans = adus.flatMap((a) => a.value.spans.flatMap((s) => validateSpan(s, state.utterances).map((i) => ({ adu: a.value.id, code: i.code }))));
  const badStances = [...state.stances.values()].filter((s) => active(s.state)).flatMap((s) => {
    const adu = s.value.viaAduId ? state.adus.get(s.value.viaAduId)?.value : undefined;
    return adu ? validateStance(adu, s.value).filter((i) => ['non_attributable_stance', 'non_committing_stance', 'rhetorical_overcommitted'].includes(i.code)).map((i) => ({ stance: s.value.id, code: i.code })) : [{ stance: s.value.id, code: 'missing_adu' }];
  });
  const highGround = [...state.insights.values()].filter((i) => active(i.state) && i.value.kind === 'higher_ground');
  const staleGround = highGround.flatMap((i) => {
    const derivation = (i.value.body as { derivation?: Record<string, string[]> }).derivation ?? {};
    const bad = Object.entries(derivation).flatMap(([key, ids]) => ids.filter((id) => !['accepts', 'accepts_conditionally'].includes(view.holders.get(id)?.get(key)?.attitude ?? '')));
    return bad.length ? [{ id: i.value.id, badRefs: bad }] : [];
  });
  let maxMs = -Infinity, outOfOrder = 0;
  for (const e of events) { if (e.mediaMs < maxMs) outOfOrder++; maxMs = Math.max(maxMs, e.mediaMs); }
  return { file, events: events.length, approvedPropositions: view.props.size, approvedAdus: adus.length, checkedSpans: adus.reduce((n, a) => n + a.value.spans.length, 0), badSpans, badStances, disagreements: view.disagreements.length, clashes: view.clashes.length, higherGround: highGround.length, higherGroundNoLongerSupportedAtEnd: staleGround, outOfOrderMediaEvents: outOfOrder };
});
console.log(JSON.stringify({ note: 'Structural checks only. Historical synthesis cards may legitimately cite commitments superseded later; they must not be presented as current.', results }, null, 2));
