/** Prepare or publish the authorized, deterministic corrections. No model calls.
 * node --import tsx apps/worker/src/qa-correct.ts [--apply]
 */
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { appendEvents, readEvents, readSessionStarts } from '@adl/db';
import { project, type DomainEvent } from '@adl/core';
import { structuralCorrections } from '../../../packages/pipeline/src/retro-corrections';
import { validateSpan, validateStance } from '../../../packages/ontology/src/index';
Object.assign(process.env, parseEnv(readFileSync('.env', 'utf8')));
const apply = process.argv.includes('--apply');
const dir = '.data/qa/release-2026-09-30';
mkdirSync(dir, { recursive: true });
async function readAll(sid: string) {
  const events: DomainEvent[] = []; let cursor = 0;
  for (;;) { const rows = await readEvents(sid, cursor, 1500); if (!rows.length) return events; events.push(...rows.map(r => r.event)); cursor = rows.at(-1)!.cursor; }
}
const starts = await readSessionStarts();
const report = [];
for (const start of starts) {
  const payload = start.payload as Extract<DomainEvent, { type: 'session.started' }>['payload'];
  if (payload.source?.kind !== 'recording' || payload.source.host) continue;
  const sid = start.sessionId, before = await readAll(sid);
  if (!before.some(e => e.type === 'session.ended')) continue;
  const backup = `${dir}/${sid}.before.jsonl`;
  if (!existsSync(backup)) writeFileSync(backup, before.map(e => JSON.stringify(e)).join('\n') + '\n');
  const patches = structuralCorrections(before, new Date().toISOString());
  const after = project(sid, [...before, ...patches]);
  const badStances = [...after.stances.values()].filter(s => ['approved','released'].includes(s.state)).flatMap(s => {
    const a = s.value.viaAduId ? after.adus.get(s.value.viaAduId)?.value : undefined;
    return !a ? [s.value.id] : validateStance(a, s.value).filter(i => ['non_attributable_stance','non_committing_stance','rhetorical_overcommitted'].includes(i.code)).map(i => `${s.value.id}:${i.code}`);
  });
  if (badStances.length) throw new Error(`${sid}: ${badStances.length} unresolved hard stance violations`);
  for (const st of after.stances.values()) if (['approved','released'].includes(st.state)) {
    const adu = after.adus.get(st.value.viaAduId!)!.value;
    if (adu.spans.some(span => validateSpan(span, after.utterances).length)) throw new Error(`${sid}: invalid quote remains`);
  }
  if (patches.length) writeFileSync(`${dir}/${sid}.patch.jsonl`, patches.map(e => JSON.stringify(e)).join('\n') + '\n');
  if (apply && patches.length) {
    // Refuse stale plans if another actor changed this finished recording during preparation.
    const latest = await readAll(sid);
    if (JSON.stringify(latest) !== JSON.stringify(before)) throw new Error(`${sid}: changed during preparation`);
    await appendEvents(patches);
    const verified = await readAll(sid);
    for (const e of before) if (!verified.some(v => v.eventId === e.eventId && JSON.stringify(v) === JSON.stringify(e))) throw new Error(`${sid}: original event changed`);
    for (const e of patches) if (!verified.some(v => v.eventId === e.eventId && JSON.stringify(v.payload) === JSON.stringify(e.payload))) throw new Error(`${sid}: correction missing`);
    if (structuralCorrections(verified, new Date().toISOString()).length) throw new Error(`${sid}: correction is not idempotent`);
    const local = `.data/${sid}.events.jsonl`;
    if (existsSync(local)) {
      const ids = new Set(readFileSync(local, 'utf8').split('\n').filter(Boolean).map(l => (JSON.parse(l) as DomainEvent).eventId));
      const missing = patches.filter(e => !ids.has(e.eventId));
      if (missing.length) appendFileSync(local, missing.map(e => JSON.stringify(e)).join('\n') + '\n');
    }
  }
  const summary = { sessionId: sid, originalEvents: before.length, corrections: patches.length, edits: patches.filter(e => e.type === 'item.edited').length, rejections: patches.filter(e => e.type === 'item.rejected').length, applied: apply, zeroHardStanceViolations: true };
  report.push(summary); console.log(JSON.stringify(summary));
  writeFileSync(`${dir}/${apply ? 'published' : 'plan'}.json`, JSON.stringify(report, null, 2));
}
