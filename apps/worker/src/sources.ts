/** Load replay sources as `utterance.final` event streams. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DT_PARTICIPANTS,
  dtSegmentsToUtterances,
  utterancesToEvents,
  type DomainEvent,
  type DtSegment,
  type FixtureParticipant,
  type OfflineUtterance,
} from '@adl/core';

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export interface FixtureMeta {
  title: string;
  format: string;
  seats?: Record<string, 'aff' | 'neg' | 'moderator' | 'audience'>;
  /** Where the event itself starts in the recording (skips teasers and to-camera intros). */
  programStartMs?: number;
}

/** Load a fixture as `utterance.final` events. `sessionId` defaults to the fixture name; pass a run id to replay it as a new session. */
export function loadFixture(name: string, sessionId: string = name): DomainEvent[] {
  if (name === 'dt') {
    const dt = JSON.parse(readFileSync(`${REPO_ROOT}fixtures/dt/transcript_diarized.json`, 'utf8')) as { segments: DtSegment[] };
    return utterancesToEvents({
      sessionId,
      title: 'No Such Thing As Evil? (Marcus × Demartini)',
      format: 'open',
      participants: DT_PARTICIPANTS,
      utterances: dtSegmentsToUtterances(dt.segments),
    });
  }
  // fixtures/antidebate/<slug>: manifest.json + transcript.utterances.json (from services/capture offline)
  const dir = `${REPO_ROOT}fixtures/antidebate/${name}`;
  const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8')) as {
    title: string;
    format: string;
    moderator?: { key: string; displayName: string };
    /** Co-moderators / hosts (keys MOD, MOD2, …); `moderator` is kept for single-moderator manifests. */
    moderators?: { key: string; displayName: string }[];
    participants: { key: string; displayName: string }[];
    speakerMap?: Record<string, string>;
    seats?: FixtureMeta['seats'];
  };
  const transcript = JSON.parse(readFileSync(`${dir}/transcript.utterances.json`, 'utf8')) as { utterances: OfflineUtterance[] };
  const labelsFor = (key: string) => Object.entries(manifest.speakerMap ?? {}).filter(([, k]) => k === key).map(([label]) => label);
  const participants: FixtureParticipant[] = [
    ...manifest.participants.map((p) => ({ ...p, role: 'debater' as const, sourceLabels: labelsFor(p.key) })),
    ...(manifest.moderators ?? (manifest.moderator ? [manifest.moderator] : [])).map((m) => ({ ...m, role: 'moderator' as const, sourceLabels: labelsFor(m.key) })),
  ];
  return utterancesToEvents({ sessionId, title: manifest.title, format: manifest.format, participants, utterances: transcript.utterances });
}

export function fixtureMeta(name: string): FixtureMeta {
  if (name === 'dt') return { title: 'No Such Thing As Evil? (Marcus × Demartini)', format: 'open' };
  const m = JSON.parse(readFileSync(`${REPO_ROOT}fixtures/antidebate/${name}/manifest.json`, 'utf8')) as FixtureMeta;
  return { title: m.title, format: m.format, ...(m.seats ? { seats: m.seats } : {}), ...(m.programStartMs ? { programStartMs: m.programStartMs } : {}) };
}
