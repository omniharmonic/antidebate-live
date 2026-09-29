/**
 * Render an L1 run as a markdown review sheet: each turn's text, then every ADU
 * with its verbatim quotes, the propositions and stances it produced, relations,
 * and validator issues. Used for hand-grading against ONTOLOGY §8 (evals/results.md).
 *
 *   pnpm --filter @adl/worker review -- --fixture dt [--out ../../.data/dt.l1.review.md]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { project, type DomainEvent } from '@adl/core';
import { TurnBuffer, type Turn } from '@adl/pipeline';
import { loadFixture, REPO_ROOT } from './sources';

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    fixture: { type: 'string', default: 'dt' },
    in: { type: 'string' },
    out: { type: 'string' },
  },
});

const fixture = values.fixture!;
const state = project(fixture, loadFixture(fixture));
const buffer = new TurnBuffer(fixture);
const turns = new Map<string, Turn>();
for (const id of state.utteranceOrder) for (const t of buffer.push(state.utterances.get(id)!)) turns.set(t.turnId, t);
const last = buffer.flush();
if (last) turns.set(last.turnId, last);

const inPath = values.in ?? `${REPO_ROOT}.data/${fixture}.l1.events.jsonl`;
const events = readFileSync(inPath, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as DomainEvent);

// Every L1 id is `${turnId}:${ref}`; turnIds themselves contain one colon (e.g. dt:t0020).
const turnOf = (id: string) => id.split(':').slice(0, 2).join(':');
const short = (id: string, turnId: string) => (turnOf(id) === turnId ? id.split(':').slice(2).join(':') : id);

const byTurn = new Map<string, DomainEvent[]>();
for (const e of events) {
  const key = turnOf(e.eventId);
  byTurn.set(key, [...(byTurn.get(key) ?? []), e]);
}

const lines: string[] = [`# L1 review: ${fixture}`, '', `Source: \`${inPath.replace(REPO_ROOT, '')}\``, ''];
for (const [turnId, es] of byTurn) {
  const turn = turns.get(turnId);
  lines.push(`## ${turnId} · ${turn?.participantKey ?? '?'} · ${turn ? `${(turn.startMs / 1000).toFixed(0)}s` : ''}`, '');
  if (turn) lines.push(`> ${turn.text.replace(/\n/g, ' ')}`, '');
  const issues = new Map<string, string[]>();
  for (const e of es) {
    if (e.type !== 'validation.result' || e.payload.issues.length === 0) continue;
    const k = short(e.payload.itemId, turnId);
    issues.set(k, [...(issues.get(k) ?? []), ...e.payload.issues.map((i) => `${i.code}: ${i.message}`)]);
  }
  for (const e of es) {
    switch (e.type) {
      case 'adu.proposed': {
        const a = e.payload.adu;
        lines.push(`- **${short(a.id, turnId)}** \`${a.speechAct}\` → ${a.spans.map((s) => `"${s.quote}"`).join(' … ')}`);
        break;
      }
      case 'proposition.proposed': {
        const p = e.payload.proposition;
        const scope = [p.scope.quantifier, p.scope.domain, p.scope.timeHorizon].filter(Boolean).join(', ');
        lines.push(`- **${short(p.id, turnId)}** _${p.type}/${p.stratum}; ${scope}_ ${p.canonical}${p.conditions.length ? ` (if: ${p.conditions.join('; ')})` : ''}`);
        for (const i of issues.get(short(p.id, turnId)) ?? []) lines.push(`  - ⚠ ${i}`);
        break;
      }
      case 'stance.proposed': {
        const s = e.payload.stance;
        lines.push(`- stance ${s.participantKey} **${s.attitude}/${s.strength}** ${short(s.propositionId, turnId)} via ${s.viaAduId ? short(s.viaAduId, turnId) : "—"}`);
        break;
      }
      case 'relation.proposed': {
        const r = e.payload.relation;
        lines.push(`- rel ${short(r.fromId, turnId)} **${r.type}** ${short(r.toId, turnId)}${r.scheme ? ` (${r.scheme})` : ''}: ${r.rationale}`);
        break;
      }
      case 'validation.result': {
        const k = short(e.payload.itemId, turnId);
        if (e.payload.issues.some((i) => i.code === 'span_quote_mismatch')) lines.push(`- ⚠ ${k}: quote not found verbatim; ADU dropped`);
        break;
      }
      default:
        break;
    }
  }
  lines.push('');
}

const out = values.out ?? `${REPO_ROOT}.data/${fixture}.l1.review.md`;
writeFileSync(out, lines.join('\n'));
console.log(`${byTurn.size} turns → ${out}`);
