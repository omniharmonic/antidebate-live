/**
 * Run a session through the live pipeline (docs/R0_DEMO.md).
 *
 * Replay a recording as if it were live (the proof that live works):
 *   pnpm --filter @adl/worker run:session -- --fixture ball-kokotajlo-ai-governance --speed 1
 *   … --speed 4 --from 20 --to 35        # a 15-minute window at 4×
 * Live room (utterances arrive from services/capture via POST /api/events):
 *   pnpm --filter @adl/worker run:session -- --live --session <id> \
 *     --title "…" --format anti-debate --debaters "A=Dean Ball:neg,B=Daniel Kokotajlo:aff" --moderator "MOD=Liv Boeree"
 *
 * Writes to Neon when DATABASE_URL is set (the deployed web app reads it), else to
 * .data/<session>.events.jsonl (the local web app tails it). --file forces the file.
 */
import { parseArgs } from 'node:util';
import { config } from 'dotenv';
import type { DomainEvent } from '@adl/core';
import { provider } from '@adl/llm';
import { SessionEngine } from './engine';
import { callCostUsd, openLog } from './log';
import { fixtureMeta, loadFixture, REPO_ROOT } from './sources';

config({ path: `${REPO_ROOT}.env`, quiet: true });

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    fixture: { type: 'string' },
    live: { type: 'boolean', default: false },
    session: { type: 'string' },
    speed: { type: 'string', default: '1' },
    from: { type: 'string' },
    to: { type: 'string' },
    file: { type: 'boolean', default: false },
    title: { type: 'string' },
    format: { type: 'string', default: 'anti-debate' },
    debaters: { type: 'string' },
    moderator: { type: 'string' },
  },
});

const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
const sessionId = values.session ?? `${values.fixture ?? 'live'}-${stamp}`;
if (!values.live && !values.fixture) throw new Error('Pass --fixture <name> (replay) or --live');

const log = openLog(sessionId, { file: values.file, fresh: !values.live });
let cost = 0;
let calls = 0;
const t0 = Date.now();
const clock = () => `${((Date.now() - t0) / 60000).toFixed(1).padStart(5)}m`;
const engine = new SessionEngine({
  sessionId,
  log,
  say: (l) => console.log(`${clock()}  ${l}`),
  onCall: (l) => {
    cost += callCostUsd(l);
    calls += 1;
  },
});
console.log(`session ${sessionId} → ${log.where} · LLM provider: ${provider()}${provider() === 'api' ? ` (budget $${process.env.LLM_API_BUDGET_USD ?? 'UNSET'})` : ' (no API billing)'}`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Feed a recording into the log at wall-clock pace, exactly as capture would. */
async function feed(fixture: string) {
  const meta = fixtureMeta(fixture);
  const all = loadFixture(fixture, sessionId);
  const fromMs = Math.max(values.from ? Number(values.from) * 60_000 : 0, meta.programStartMs ?? 0);
  const toMs = values.to ? Number(values.to) * 60_000 : Infinity;
  const speed = values.speed === 'max' ? Infinity : Number(values.speed);
  const start = all.find((e) => e.type === 'session.started');
  if (start?.type !== 'session.started') throw new Error('fixture has no session.started');
  await log.append([
    {
      ...start,
      wallTs: new Date().toISOString(),
      payload: {
        ...start.payload,
        title: meta.title,
        format: meta.format,
        ...(meta.seats ? { seats: meta.seats } : {}),
        source: { kind: 'recording', fixture, speed: Number.isFinite(speed) ? speed : 0 },
      },
    },
  ]);
  const utts = all.filter((e): e is Extract<DomainEvent, { type: 'utterance.final' }> => e.type === 'utterance.final' && e.mediaMs >= fromMs && e.mediaMs <= toMs);
  const wallStart = Date.now();
  const mediaStart = utts[0]?.mediaMs ?? 0;
  for (const e of utts) {
    // An utterance is "final" when it ends; replay it at that moment.
    const due = (e.payload.utterance.endMs - mediaStart) / speed;
    if (Number.isFinite(due)) await sleep(Math.max(0, wallStart + due - Date.now()));
    await log.append([{ ...e, wallTs: new Date().toISOString() }]);
  }
  console.log(`${clock()}  feeder done: ${utts.length} utterances`);
  engine.finishSource();
}

async function ensureLiveSession() {
  if (!values.title || !values.debaters) return; // session.started was created elsewhere (web /new)
  const parse = (spec: string, role: 'debater' | 'moderator') =>
    spec.split(',').map((s) => {
      const [key, rest] = s.split('=');
      const [displayName, seat] = (rest ?? '').split(':');
      return { key: key!.trim(), displayName: displayName!.trim(), role, seat: (seat?.trim() as 'aff' | 'neg' | undefined) ?? undefined };
    });
  const ps = [...parse(values.debaters, 'debater'), ...(values.moderator ? parse(values.moderator, 'moderator') : [])];
  const seats = Object.fromEntries(ps.map((p) => [p.key, p.role === 'moderator' ? 'moderator' : (p.seat ?? 'audience')] as const));
  await log.append([
    {
      eventId: `${sessionId}:start`,
      sessionId,
      type: 'session.started',
      actor: 'operator',
      mediaMs: 0,
      wallTs: new Date().toISOString(),
      payload: { title: values.title, format: values.format!, participants: ps.map(({ key, displayName, role }) => ({ key, displayName, role })), seats, source: { kind: 'live' } },
    },
  ]);
}

process.on('SIGINT', () => {
  console.log(`\n${clock()}  stopping (event log is intact; rerun with --live --session ${sessionId} to resume)`);
  engine.finishSource();
});

if (values.live) await ensureLiveSession();
const feeding = values.fixture && !values.live ? feed(values.fixture) : Promise.resolve();
await Promise.all([feeding, engine.run()]);
console.log(`${clock()}  done · ${calls} model calls · billed to API $${cost.toFixed(2)} (provider ${provider()}) · ${log.where}`);
