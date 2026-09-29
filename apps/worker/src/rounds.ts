/**
 * Run only round detection over a fixture's moderator turns: a cheap check of how a
 * recording maps onto its format, before (or instead of) a full pipeline run.
 *
 *   pnpm --filter @adl/worker rounds -- --fixture ball-kokotajlo-ai-governance
 */
import { parseArgs } from 'node:util';
import { config } from 'dotenv';
import { project } from '@adl/core';
import { provider } from '@adl/llm';
import { detectRound, TurnBuffer, type Turn } from '@adl/pipeline';
import { fixtureMeta, loadFixture, REPO_ROOT } from './sources';

config({ path: `${REPO_ROOT}.env`, quiet: true });
const { values } = parseArgs({ args: process.argv.slice(2).filter((a) => a !== '--'), options: { fixture: { type: 'string' } } });
if (!values.fixture) throw new Error('--fixture is required');
const meta = fixtureMeta(values.fixture);
const sessionId = `${values.fixture}-rounds`;
const state = project(sessionId, loadFixture(values.fixture, sessionId));
const buffer = new TurnBuffer(sessionId);
const turns: Turn[] = [];
for (const id of state.utteranceOrder) {
  const u = state.utterances.get(id)!;
  if (u.startMs < (meta.programStartMs ?? 0)) continue;
  turns.push(...buffer.push(u));
}
const last = buffer.flush();
if (last) turns.push(last);
const mod = new Set(state.participants.filter((p) => p.role === 'moderator').map((p) => p.key));
console.log(`${values.fixture}: ${turns.length} turns, ${turns.filter((t) => mod.has(t.participantKey)).length} moderator turns · provider ${provider()}`);
let current: string | null = null;
let startedMs: number | null = null;
const prev: string[] = [];
for (const t of turns) {
  if (!mod.has(t.participantKey)) continue;
  const r = await detectRound(t, { sessionId, formatId: meta.format, currentRoundId: current, currentRoundStartedMs: startedMs, previousModeratorTurns: prev.slice(-3), wallTs: () => new Date().toISOString() });
  if (r.error) console.log(`  ${(t.startMs / 60000).toFixed(1)}m error ${r.error}`);
  const started = r.events.find((e) => e.type === 'round.started');
  if (started?.type === 'round.started') {
    current = started.payload.roundId;
    startedMs = started.mediaMs;
    console.log(`  ${(t.startMs / 60000).toFixed(1).padStart(5)}m → ${started.payload.name}`);
  }
  prev.push(t.text);
}
