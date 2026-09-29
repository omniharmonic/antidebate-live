/**
 * Diagnostics for a session run (the per-ingest evaluation step). No model calls.
 *
 *   pnpm --filter @adl/worker diagnose -- --session ball-kokotajlo-r2 [--fixture ball-kokotajlo-ai-governance] [--out ../../.data/<s>.diagnose.md]
 *
 * Reports: rounds vs the format, per-speaker claims and speech acts, critic verdicts
 * and approval rates, disagreement/clash/shared-ground growth, the crux and higher
 * ground over time, prompt addressees, cost/latency per pass, and anomaly flags.
 * With --fixture, higher ground and cruxes are listed next to the manifest's
 * verified reference so recall can be judged.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { getFormat, project, type DomainEvent } from '@adl/core';
import { buildMapView } from '@adl/pipeline';
import { REPO_ROOT } from './sources';

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: { session: { type: 'string' }, fixture: { type: 'string' }, out: { type: 'string' } },
});
if (!values.session) throw new Error('--session is required');
const sid = values.session;
const events = readFileSync(`${REPO_ROOT}.data/${sid}.events.jsonl`, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as DomainEvent);
const calls = existsSync(`${REPO_ROOT}.data/${sid}.calls.jsonl`)
  ? readFileSync(`${REPO_ROOT}.data/${sid}.calls.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, number | string | boolean>)
  : [];
const s = project(sid, events);
const name = new Map(s.participants.map((p) => [p.key, p.displayName]));
const min = (ms: number) => `${(ms / 60000).toFixed(1)}m`;
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '—');
const L: string[] = [];
const flags: string[] = [];

L.push(`# Diagnostics: ${sid}`, '', `${s.title} · format ${s.formatId} · ${s.utteranceOrder.length} utterances · media to ${min(s.lastMediaMs)} · ended ${s.ended}`, '');

// Rounds
const fmt = getFormat(s.formatId ?? 'open');
const rounds = events.filter((e): e is Extract<DomainEvent, { type: 'round.started' }> => e.type === 'round.started');
L.push('## Rounds', '', '| At | Round | Phase |', '|---|---|---|');
for (const r of rounds) L.push(`| ${min(r.mediaMs)} | ${r.payload.name} | ${fmt.rounds.find((d) => d.id === r.payload.roundId)?.phase ?? ''} |`);
const seen = new Set(rounds.map((r) => r.payload.roundId));
// A moderator's own structure for a phase (an *_adapted round) stands in for that phase's named rounds.
const adaptedPhases = new Set(fmt.rounds.filter((r) => r.id.endsWith('_adapted') && seen.has(r.id)).map((r) => r.phase));
const missing = fmt.rounds.filter((r) => !r.optional && !seen.has(r.id) && !adaptedPhases.has(r.phase)).map((r) => r.name);
L.push('', `Required rounds not detected: ${missing.join(', ') || 'none'}`, '');
if (missing.length) flags.push(`rounds not detected: ${missing.join(', ')}`);
const order = rounds.map((r) => fmt.rounds.findIndex((d) => d.id === r.payload.roundId));
if (order.some((o, i) => i > 0 && o < order[i - 1]!)) flags.push('round sequence goes backwards at least once');

// Claims
const byType = (t: string) => events.filter((e) => e.type === t);
const props = [...s.propositions.values()];
const stateCount = (xs: { state: string }[]) => xs.reduce<Record<string, number>>((m, x) => ((m[x.state] = (m[x.state] ?? 0) + 1), m), {});
L.push('## Claims', '', `Propositions ${props.length} · ${JSON.stringify(stateCount(props))}`, `Stances ${s.stances.size} · Relations ${s.relations.size} (${[...s.relations.values()].filter((r) => r.value.inferred).length} inferred by L3) · ADUs ${s.adus.size}`, '');
L.push('| Speaker | Utterances | ADUs | Speech acts | Approved stances |', '|---|---|---|---|---|');
for (const p of s.participants) {
  const utts = s.utteranceOrder.filter((id) => s.utterances.get(id)?.participantKey === p.key).length;
  const adus = [...s.adus.values()].filter((a) => a.value.speakerKey === p.key);
  const acts = adus.reduce<Record<string, number>>((m, a) => ((m[a.value.speechAct] = (m[a.value.speechAct] ?? 0) + 1), m), {});
  const st = [...s.stances.values()].filter((x) => x.value.participantKey === p.key && (x.state === 'approved' || x.state === 'released')).length;
  L.push(`| ${p.displayName} (${p.key}, ${p.role}) | ${utts} | ${adus.length} | ${Object.entries(acts).map(([k, v]) => `${k} ${v}`).join(', ')} | ${st} |`);
}
const unk = s.utteranceOrder.filter((id) => s.utterances.get(id)?.participantKey === 'UNK').length;
L.push('', `Unattributed utterances: ${unk}`, '');
const modAdus = [...s.adus.values()].filter((a) => s.participants.find((p) => p.key === a.value.speakerKey)?.role === 'moderator').length;
if (modAdus) flags.push(`${modAdus} ADUs attributed to the moderator (moderator turns should only drive rounds)`);

// Critic
const verdicts = byType('critic.verdict').map((e) => (e as Extract<DomainEvent, { type: 'critic.verdict' }>).payload);
const vc = verdicts.reduce<Record<string, number>>((m, v) => ((m[v.verdict] = (m[v.verdict] ?? 0) + 1), m), {});
const rules = verdicts.filter((v) => v.verdict !== 'pass').reduce<Record<string, number>>((m, v) => ((m[v.reason.split(':')[0]!] = (m[v.reason.split(':')[0]!] ?? 0) + 1), m), {});
L.push('## Critic', '', `${verdicts.length} verdicts · pass ${vc.pass ?? 0} · repair ${vc.repair ?? 0} · reject ${vc.reject ?? 0} · non-pass by rule ${JSON.stringify(rules)}`, '');
const validation = byType('validation.result').map((e) => (e as Extract<DomainEvent, { type: 'validation.result' }>).payload).filter((v) => v.issues.length);
const codes = validation.flatMap((v) => v.issues.map((i) => i.code)).reduce<Record<string, number>>((m, c) => ((m[c] = (m[c] ?? 0) + 1), m), {});
L.push(`Validator flags: ${JSON.stringify(codes)}`, '');
if ((vc.pass ?? 0) / Math.max(1, verdicts.length) > 0.9) flags.push('critic passes >90%: check it is not rubber-stamping');

// Map dynamics + insights
const view = buildMapView(s);
L.push('## Map at the end', '', `${view.props.size} approved propositions · ${view.disagreements.length} stated disagreements · ${view.clashes.length} clashes · ${view.commonGround.length} shared`, '');
if (view.disagreements.length === 0) flags.push('no stated disagreements: both debaters never took stances on the same proposition (identity resolution / cross-speaker stances)');
const ins = [...s.insights.values()].map((t) => ({ t, i: t.value }));
const at = (id: string) => events.find((e) => e.type === 'insight.proposed' && e.payload.insight.id === id)?.mediaMs ?? 0;
L.push('## Crux over time', '');
let lastCrux = '';
for (const { i } of ins.filter((x) => x.i.kind === 'crux')) {
  const b = i.body as { statement: string; basis: string; sides: { participantKey: string; attitude: string }[]; settlingEvidence: string };
  if (b.statement === lastCrux) continue;
  lastCrux = b.statement;
  L.push(`- ${min(at(i.id))} **${b.statement}** (${b.basis}; ${b.settlingEvidence}; ${b.sides.map((x) => `${name.get(x.participantKey)} ${x.attitude}`).join(' / ')})`);
}
L.push('', '## Higher ground (distinct)', '');
const hg = [...new Set(ins.filter((x) => x.i.kind === 'higher_ground').map((x) => `${min(at(x.i.id))} ${(x.i.body as { text: string; construction: string }).text} (${(x.i.body as { construction: string }).construction})`))];
hg.forEach((h) => L.push(`- ${h}`));
if (!hg.length) flags.push('no higher-ground candidates');
L.push('', '## Prompts (sample)', '');
const prompts = ins.filter((x) => x.i.kind === 'prompt').map((x) => x.i.body as { text: string; addresseeKey: string; kind: string });
const toBoth = prompts.filter((p) => p.addresseeKey === 'both').length;
prompts.slice(-8).forEach((p) => L.push(`- (${p.kind} → ${name.get(p.addresseeKey) ?? p.addresseeKey}) ${p.text}`));
L.push('', `${prompts.length} prompts · ${toBoth} addressed to both`, '');

// Reference
if (values.fixture && existsSync(`${REPO_ROOT}fixtures/antidebate/${values.fixture}/manifest.json`)) {
  const m = JSON.parse(readFileSync(`${REPO_ROOT}fixtures/antidebate/${values.fixture}/manifest.json`, 'utf8')) as { reference?: { publishedSynthesis?: string[]; cruxes?: string[] } };
  L.push('## Reference (judge recall by reading)', '', '**Verified synthesis:**', ...(m.reference?.publishedSynthesis ?? []).map((x) => `- ${x}`), '', '**Reference cruxes:**', ...(m.reference?.cruxes ?? []).map((x) => `- ${x}`), '');
}

// Cost / latency
if (calls.length) {
  L.push('## Model calls', '', '| Pass | Calls | Cached | p50 s | In tok (avg) | Out tok (avg) | Billed $ |', '|---|---|---|---|---|---|---|');
  const passes = [...new Set(calls.map((c) => String(c.pass)))];
  for (const p of passes) {
    const cs = calls.filter((c) => c.pass === p);
    const lat = cs.map((c) => Number(c.latencyMs)).sort((a, b) => a - b);
    const avg = (k: string) => Math.round(cs.reduce((n, c) => n + Number(c[k] ?? 0), 0) / cs.length);
    L.push(`| ${p} | ${cs.length} | ${cs.filter((c) => c.cached).length} | ${((lat[Math.floor(lat.length / 2)] ?? 0) / 1000).toFixed(1)} | ${avg('inputTokens') + avg('cacheReadTokens') + avg('cacheCreationTokens')} | ${avg('outputTokens')} | ${cs.reduce((n, c) => n + Number(c.billedUsd ?? 0), 0).toFixed(2)} |`);
  }
  const errors = calls.filter((c) => !c.cached && Number(c.outputTokens) === 0).length;
  if (errors) flags.push(`${errors} model calls returned no output (provider errors)`);
  L.push('');
}

L.push('## Flags', '', ...(flags.length ? flags.map((f) => `- ${f}`) : ['- none']), '');
const out = values.out ?? `${REPO_ROOT}.data/${sid}.diagnose.md`;
writeFileSync(out, L.join('\n'));
console.log(L.join('\n'));
