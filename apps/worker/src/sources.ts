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

export function loadFixture(name: string): DomainEvent[] {
  if (name === 'dt') {
    const dt = JSON.parse(readFileSync(`${REPO_ROOT}fixtures/dt/transcript_diarized.json`, 'utf8')) as { segments: DtSegment[] };
    return utterancesToEvents({
      sessionId: 'dt',
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
    participants: { key: string; displayName: string }[];
    speakerMap?: Record<string, string>;
  };
  const transcript = JSON.parse(readFileSync(`${dir}/transcript.utterances.json`, 'utf8')) as { utterances: OfflineUtterance[] };
  const labelsFor = (key: string) => Object.entries(manifest.speakerMap ?? {}).filter(([, k]) => k === key).map(([label]) => label);
  const participants: FixtureParticipant[] = [
    ...manifest.participants.map((p) => ({ ...p, role: 'debater' as const, sourceLabels: labelsFor(p.key) })),
    ...(manifest.moderator ? [{ ...manifest.moderator, role: 'moderator' as const, sourceLabels: labelsFor(manifest.moderator.key) }] : []),
  ];
  return utterancesToEvents({ sessionId: name, title: manifest.title, format: manifest.format, participants, utterances: transcript.utterances });
}
