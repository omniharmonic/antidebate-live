import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { DomainEvent } from './events';
import { DT_PARTICIPANTS, dtSegmentsToUtterances, utterancesToEvents, type DtSegment } from './fixtures';
import { apply, project } from './reduce';
import { serialize, stateAt, SNAPSHOT_EVERY } from './snapshot';
import { emptyState } from './state';
import { audienceView } from './visibility';

const dtPath = fileURLToPath(new URL('../../../fixtures/dt/transcript_diarized.json', import.meta.url));
const dt = JSON.parse(readFileSync(dtPath, 'utf8')) as { segments: DtSegment[] };
const events = utterancesToEvents({
  sessionId: 'dt',
  title: 'No Such Thing As Evil?',
  format: 'open',
  participants: DT_PARTICIPANTS,
  utterances: dtSegmentsToUtterances(dt.segments),
});

describe('DT fixture replay', () => {
  it('produces one utterance event per segment, all attributed', () => {
    const s = project('dt', events);
    expect(s.utteranceOrder.length).toBe(dt.segments.length);
    const unknown = [...s.utterances.values()].filter((u) => u.participantKey === 'UNK');
    expect(unknown.length).toBeLessThanOrEqual(1); // the source has one 'unknown' segment
  });

  it('is deterministic', () => {
    expect(serialize(project('dt', events))).toEqual(serialize(project('dt', events)));
  });

  it('seeks via snapshots to the same state as a full replay', () => {
    const snapshots: { atIndex: number; state: unknown }[] = [];
    let s = emptyState('dt');
    events.forEach((e, i) => {
      s = apply(s, e);
      if ((i + 1) % SNAPSHOT_EVERY === 0) snapshots.push({ atIndex: i + 1, state: serialize(s) });
    });
    const t = 45 * 60 * 1000;
    const direct = stateAt('dt', events, t);
    const viaSnap = stateAt('dt', events, t, snapshots);
    expect(serialize(viaSnap)).toEqual(serialize(direct));
  });
});

describe('audience safety', () => {
  const base = events.slice(0, 3);
  const wall = '2026-01-01T00:00:00.000Z';
  const prop: DomainEvent = {
    eventId: 'p1',
    sessionId: 'dt',
    type: 'proposition.proposed',
    actor: 'system',
    mediaMs: 20_000,
    wallTs: wall,
    payload: {
      proposition: { id: 'p1', canonical: 'Evil is a perception born of incomplete awareness.', type: 'normative', stratum: 'ontology', scope: { quantifier: 'generic' }, conditions: [], quantities: [], aboutConcepts: [], status: 'live_provisional' },
    },
  };
  const dial = (level: 0 | 4): DomainEvent => ({ eventId: `d${level}`, sessionId: 'dt', type: 'dial.set', actor: 'facilitator', mediaMs: 21_000, wallTs: wall, payload: { channel: 'stage', level } });

  it('shows nothing at level 0 (Stephanie default)', () => {
    const s = project('dt', [...base, prop, { ...prop, eventId: 'a', type: 'item.approved', payload: { itemId: 'p1' } } as DomainEvent]);
    expect(audienceView(s, 'stage')).toEqual({ channel: 'stage', level: 0, blackout: false, spotlight: null });
  });

  it('never shows unreleased propositions, even at level 4', () => {
    const s = project('dt', [...base, prop, dial(4)]);
    expect(audienceView(s, 'stage').propositions).toEqual([]);
  });

  it('shows released propositions at level 4 and hides everything on blackout', () => {
    const approved = { ...prop, eventId: 'a', type: 'item.approved', payload: { itemId: 'p1' } } as DomainEvent;
    const released = { ...prop, eventId: 'r', type: 'release.published', payload: { itemIds: ['p1'], channels: ['stage'] } } as DomainEvent;
    const s = project('dt', [...base, prop, approved, released, dial(4)]);
    expect(audienceView(s, 'stage').propositions?.map((p) => p.id)).toEqual(['p1']);
    const dark = project('dt', [...base, prop, approved, released, dial(4), { ...prop, eventId: 'b', type: 'blackout.set', payload: { on: true } } as DomainEvent]);
    expect(audienceView(dark, 'stage').level).toBe(0);
  });
});

describe('identity merges (L3)', () => {
  const base = { sessionId: 'm', actor: 'system' as const, mediaMs: 0, wallTs: '2026-01-01T00:00:00.000Z' };
  const prop = (id: string, canonical: string) => ({ ...base, eventId: `${id}:p`, type: 'proposition.proposed' as const, payload: { proposition: { id, canonical, type: 'prescriptive' as const, stratum: 'praxis' as const, scope: { quantifier: 'generic' as const }, conditions: [], quantities: [], aboutConcepts: [], status: 'live_provisional' as const } } });
  const stance = (id: string, pid: string, key: string, attitude: 'accepts' | 'rejects') => ({ ...base, eventId: `${id}:s`, type: 'stance.proposed' as const, payload: { stance: { id, participantKey: key, propositionId: pid, atMs: 0, attitude, strength: 'confident' as const, source: 'stated' as const } } });
  it('re-points stances to the surviving proposition', () => {
    const s = project('m', [prop('P', 'Labs should be audited.'), prop('Q', 'Frontier labs should be audited.'), stance('s1', 'P', 'A', 'accepts'), stance('s2', 'Q', 'B', 'accepts'), { ...base, eventId: 'mg', type: 'item.merged', payload: { fromId: 'Q', intoId: 'P' } }]);
    expect(s.stances.get('s2')?.value.propositionId).toBe('P');
    expect(s.propositions.get('Q')?.state).toBe('merged');
  });
  it('retires stances on a negated duplicate', () => {
    const s = project('m', [prop('P', 'Labs should be licensed.'), prop('Q', 'Labs should not need licenses.'), stance('s2', 'Q', 'B', 'accepts'), stance('s3', 'P', 'B', 'rejects'), { ...base, eventId: 'mg', type: 'item.merged', payload: { fromId: 'Q', intoId: 'P', negated: true } }]);
    expect(s.stances.get('s2')?.state).toBe('merged');
    expect(s.stances.get('s3')?.value.attitude).toBe('rejects');
  });
});
