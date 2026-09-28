/**
 * Replay a recorded debate as if it were live (IMPLEMENTATION_PLAN M0).
 *
 *   pnpm --filter @adl/worker replay -- --fixture dt --speed max --out ../../.data/dt.events.jsonl
 *   pnpm --filter @adl/worker replay -- --fixture ball-kokotajlo-ai-governance --speed 4 --db
 *
 * --speed: 1 (real time), N (N× faster), or max. --db appends to Postgres (DATABASE_URL).
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { config } from 'dotenv';
import { project, type DomainEvent } from '@adl/core';
import { appendEvents, hasDb } from '@adl/db';
import { loadFixture, REPO_ROOT } from './sources';

config({ path: `${REPO_ROOT}.env`, quiet: true });

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    fixture: { type: 'string', default: 'dt' },
    speed: { type: 'string', default: 'max' },
    out: { type: 'string' },
    db: { type: 'boolean', default: false },
    limit: { type: 'string' },
  },
});

const events = loadFixture(values.fixture!);
const limited = values.limit ? events.slice(0, Number(values.limit)) : events;
const speed = values.speed === 'max' ? Infinity : Number(values.speed);
const outPath = values.out ? resolve(process.cwd(), values.out) : null;
if (outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, '');
}
if (values.db && !hasDb()) throw new Error('--db requires DATABASE_URL');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let prevMs = 0;
for (const e of limited) {
  if (Number.isFinite(speed)) await sleep(Math.max(0, (e.mediaMs - prevMs) / speed));
  prevMs = e.mediaMs;
  if (outPath) appendFileSync(outPath, `${JSON.stringify(e)}\n`);
  if (values.db) await appendEvents([e as DomainEvent]);
  if (Number.isFinite(speed) && e.type === 'utterance.final') {
    const u = e.payload.utterance;
    console.log(`${(u.startMs / 1000).toFixed(0).padStart(5)}s ${u.participantKey}: ${u.text.slice(0, 100)}`);
  }
}
const s = project(values.fixture!, limited);
console.log(`replayed ${limited.length} events · ${s.utteranceOrder.length} utterances · ${s.participants.map((p) => `${p.key}=${p.displayName}`).join(', ')}${outPath ? ` → ${outPath}` : ''}`);
