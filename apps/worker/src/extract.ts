/**
 * Run L0 (turns) and, with --llm, L1 extraction over a replay (IMPLEMENTATION_PLAN WS2).
 *
 *   pnpm --filter @adl/worker extract -- --fixture dt --turns 12            # turns only, no API calls
 *   pnpm --filter @adl/worker extract -- --fixture dt --turns 12 --llm      # + L1 (needs ANTHROPIC_API_KEY)
 *
 * Writes events to .data/<fixture>.l1.events.jsonl and prints a cost/latency summary.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { config } from 'dotenv';
import { project } from '@adl/core';
import { setLlmLogSink, type LlmCallLog } from '@adl/llm';
import { TurnBuffer, runL1, type Turn } from '@adl/pipeline';
import { loadFixture, REPO_ROOT } from './sources';

config({ path: `${REPO_ROOT}.env`, quiet: true });

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    fixture: { type: 'string', default: 'dt' },
    turns: { type: 'string', default: '10' },
    skip: { type: 'string', default: '0' },
    llm: { type: 'boolean', default: false },
  },
});

const events = loadFixture(values.fixture!);
const state = project(values.fixture!, events);
const buffer = new TurnBuffer(values.fixture!);
const turns: Turn[] = [];
for (const id of state.utteranceOrder) turns.push(...buffer.push(state.utterances.get(id)!));
const last = buffer.flush();
if (last) turns.push(last);

const skip = Number(values.skip);
const selected = turns.slice(skip, skip + Number(values.turns));
console.log(`${turns.length} turns total; processing ${selected.length} (from #${skip})`);

if (!values.llm) {
  for (const t of selected) console.log(`\n[${t.turnId}] ${t.participantKey} ${(t.startMs / 1000).toFixed(0)}–${(t.endMs / 1000).toFixed(0)}s\n${t.text}`);
  process.exit(0);
}

const logs: LlmCallLog[] = [];
const out = `${REPO_ROOT}.data/${values.fixture}.l1.events.jsonl`;
const callsOut = `${REPO_ROOT}.data/${values.fixture}.l1.calls.jsonl`;
mkdirSync(`${REPO_ROOT}.data`, { recursive: true });
writeFileSync(out, '');
writeFileSync(callsOut, '');
setLlmLogSink((l) => {
  logs.push(l);
  appendFileSync(callsOut, `${JSON.stringify(l)}\n`);
});

const index: { id: string; canonical: string }[] = [];
for (const [i, turn] of selected.entries()) {
  const res = await runL1(turn, {
    sessionId: values.fixture!,
    participants: state.participants,
    round: null,
    recentTurns: selected.slice(Math.max(0, i - 3), i),
    propositionIndex: index,
    utterances: state.utterances,
    wallTs: () => new Date().toISOString(),
  });
  for (const e of res.events) {
    appendFileSync(out, `${JSON.stringify(e)}\n`);
    if (e.type === 'proposition.proposed') index.push({ id: e.payload.proposition.id, canonical: e.payload.proposition.canonical });
  }
  const props = res.events.filter((e) => e.type === 'proposition.proposed').length;
  const fails = res.events.filter((e) => e.type === 'validation.result' && e.payload.issues.length > 0).length;
  console.log(`${turn.turnId} ${turn.participantKey}: ${props} props, ${fails} validation fails, ${res.log.latencyMs} ms${res.error ? ` ERROR ${res.error}` : ''}`);
}

const cost = logs.reduce((c, l) => c + l.billedUsd, 0);
const lat = logs.map((l) => l.latencyMs).sort((a, b) => a - b);
const pct = (q: number) => lat[Math.min(lat.length - 1, Math.floor(lat.length * q))] ?? 0;
console.log(`\n${logs[0]?.promptVersion ?? ''} · ${logs.length} calls · p50 ${pct(0.5)} ms · p90 ${pct(0.9)} ms · billed $${cost.toFixed(2)} · cache reads ${logs.reduce((n, l) => n + l.cacheReadTokens, 0)} tok → ${out}`);
