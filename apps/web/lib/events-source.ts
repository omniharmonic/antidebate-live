/**
 * Server-only event access. With DATABASE_URL: the Postgres event log.
 * Without it (local dev): replay files in .data/ written by `pnpm replay:dt`,
 * falling back to converting the DT fixture in memory.
 */
import 'server-only';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DT_PARTICIPANTS, dtSegmentsToUtterances, utterancesToEvents, type DomainEvent, type DtSegment } from '@adl/core';

const REPO_ROOT = path.resolve(process.cwd(), '../..');

export function loadLocalEvents(sessionId: string): DomainEvent[] {
  const file = path.join(REPO_ROOT, '.data', `${sessionId}.events.jsonl`);
  if (existsSync(file)) {
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as DomainEvent);
  }
  if (sessionId === 'dt') {
    const dt = JSON.parse(readFileSync(path.join(REPO_ROOT, 'fixtures/dt/transcript_diarized.json'), 'utf8')) as { segments: DtSegment[] };
    return utterancesToEvents({ sessionId: 'dt', title: 'No Such Thing As Evil? (Marcus × Demartini)', format: 'open', participants: DT_PARTICIPANTS, utterances: dtSegmentsToUtterances(dt.segments) });
  }
  return [];
}
