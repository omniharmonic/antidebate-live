/**
 * Server-only event access. With DATABASE_URL: the Postgres event log.
 * Without it (local dev): `.data/<session>.events.jsonl`, written by the worker
 * and appended to live; the DT fixture is converted in memory as a last resort.
 */
import 'server-only';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import path from 'node:path';
import { isValidSessionId } from './session-id';
import { DT_PARTICIPANTS, dtSegmentsToUtterances, utterancesToEvents, type DomainEvent, type DtSegment } from '@adl/core';

export const REPO_ROOT = path.resolve(process.cwd(), '../..');
export const DATA_DIR = path.join(REPO_ROOT, '.data');

export { isValidSessionId };

export function localFile(sessionId: string): string {
  if (!isValidSessionId(sessionId)) throw new Error(`invalid session id: ${sessionId}`);
  return path.join(DATA_DIR, `${sessionId}.events.jsonl`);
}

function parseLines(text: string): DomainEvent[] {
  const out: DomainEvent[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as DomainEvent);
    } catch {
      // a line being written right now; the tailer re-reads it on the next poll
    }
  }
  return out;
}

function dtFixtureEvents(): DomainEvent[] {
  const dt = JSON.parse(readFileSync(path.join(REPO_ROOT, 'fixtures/dt/transcript_diarized.json'), 'utf8')) as { segments: DtSegment[] };
  return utterancesToEvents({ sessionId: 'dt', title: 'No Such Thing As Evil? (Marcus × Demartini)', format: 'open', participants: DT_PARTICIPANTS, utterances: dtSegmentsToUtterances(dt.segments) });
}

export function loadLocalEvents(sessionId: string): DomainEvent[] {
  if (!isValidSessionId(sessionId)) return [];
  const file = localFile(sessionId);
  if (existsSync(file)) return parseLines(readFileSync(file, 'utf8'));
  if (sessionId === 'dt') return dtFixtureEvents();
  return [];
}

/**
 * Incremental reader for a growing JSONL file. `read()` returns complete lines
 * appended since the last call; a trailing partial line waits for the next poll.
 */
export class JsonlTail {
  private offset = 0;
  private carry = '';
  private fixtureSent = false;
  /** Set when the file shrank (rewritten by a rerun); the caller tells clients to start over. */
  truncated = false;
  constructor(private readonly sessionId: string) {}

  read(): DomainEvent[] {
    const file = localFile(this.sessionId);
    if (!existsSync(file)) {
      if (this.sessionId === 'dt' && !this.fixtureSent) {
        this.fixtureSent = true;
        return dtFixtureEvents();
      }
      return [];
    }
    const size = statSync(file).size;
    if (size < this.offset) {
      // truncated or rewritten: start over
      this.offset = 0;
      this.carry = '';
      this.truncated = true;
    }
    if (size === this.offset) return [];
    const fd = openSync(file, 'r');
    try {
      const buf = Buffer.alloc(size - this.offset);
      readSync(fd, buf, 0, buf.length, this.offset);
      this.offset = size;
      const text = this.carry + buf.toString('utf8');
      const cut = text.lastIndexOf('\n');
      if (cut === -1) {
        this.carry = text;
        return [];
      }
      this.carry = text.slice(cut + 1);
      return parseLines(text.slice(0, cut));
    } finally {
      closeSync(fd);
    }
  }
}

/** Local-mode append (operator actions and new sessions without DATABASE_URL). */
export function appendLocalEvents(sessionId: string, events: DomainEvent[]): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const file = localFile(sessionId);
  const existing = existsSync(file) ? new Set(loadLocalEvents(sessionId).map((e) => e.eventId)) : new Set<string>();
  const fresh = events.filter((e) => !existing.has(e.eventId));
  if (fresh.length === 0) return;
  appendFileSync(file, fresh.map((e) => JSON.stringify(e)).join('\n') + '\n');
}
