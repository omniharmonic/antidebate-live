/**
 * Copy a local session log (.data/<session>.events.jsonl) into Neon so the deployed
 * web app can show it. Idempotent: events are keyed by eventId.
 *
 *   pnpm --filter @adl/worker push -- --session ball-kokotajlo-r1
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { config } from 'dotenv';
import type { DomainEvent } from '@adl/core';
import { appendEvents, hasDb } from '@adl/db';
import { REPO_ROOT } from './sources';

config({ path: `${REPO_ROOT}.env`, quiet: true });
const { values } = parseArgs({ args: process.argv.slice(2).filter((a) => a !== '--'), options: { session: { type: 'string' } } });
if (!values.session) throw new Error('--session is required');
if (!hasDb()) throw new Error('DATABASE_URL is not set');
const events = readFileSync(`${REPO_ROOT}.data/${values.session}.events.jsonl`, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as DomainEvent);
for (let i = 0; i < events.length; i += 200) {
  await appendEvents(events.slice(i, i + 200));
  process.stdout.write(`\r${Math.min(i + 200, events.length)}/${events.length}`);
}
console.log(`\npushed ${values.session} → Neon`);
