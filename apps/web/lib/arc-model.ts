/**
 * Data model for the arc view: every mark is a stance, relation, interval or
 * card from the log. Layout (pixels) lives in the component.
 */
import type { DomainEvent, SessionState } from '@adl/core';
import type { Proposition, Stance } from '@adl/ontology';
import { groundOverTime, insightMoments, isLive, liveStances, roundsOf, type Band, type InsightMoment, type Interval, type RoundMark, type SessionMeta } from './derive';

export interface ArcMark {
  stanceId: string;
  propositionId: string;
  participantKey: string;
  lane: 0 | 1;
  tMs: number;
  stratum: Proposition['stratum'];
  type: Proposition['type'];
  attitude: Stance['attitude'];
  strength: Stance['strength'];
  source: Stance['source'];
}

export interface ArcRelation {
  id: string;
  type: string;
  fromPid: string;
  toPid: string;
  fromLane: 0 | 1;
  toLane: 0 | 1;
}

export interface ArcModel {
  sideKeys: [string, string] | null;
  marks: ArcMark[];
  relations: ArcRelation[];
  disputes: Interval[];
  shared: Interval[];
  cards: InsightMoment[];
  rounds: RoundMark[];
  bands: Band[];
  speaking: { key: string; startMs: number; endMs: number }[];
  /** Step series: count after each change point. */
  series: { tMs: number; disputes: number; shared: number }[];
  endMs: number;
}

const ATTACKS = new Set(['rebuts', 'undercuts', 'undermines']);

export function buildArcModel(s: SessionState, events: readonly DomainEvent[], meta: SessionMeta, endMs: number): ArcModel {
  const [pa, pb] = meta.sides;
  const sideKeys: [string, string] | null = pa && pb ? [pa.key, pb.key] : null;
  const laneOf = (k: string): 0 | 1 | null => (pa && k === pa.key ? 0 : pb && k === pb.key ? 1 : null);

  const stances = liveStances(s);
  const marks: ArcMark[] = [];
  /** proposition → first lane that holds it (for relation endpoints). */
  const holder = new Map<string, 0 | 1>();
  for (const st of [...stances].sort((x, y) => x.atMs - y.atMs)) {
    const lane = laneOf(st.participantKey);
    const p = s.propositions.get(st.propositionId);
    if (lane === null || !p) continue;
    if (!holder.has(st.propositionId)) holder.set(st.propositionId, lane);
    marks.push({
      stanceId: st.id,
      propositionId: st.propositionId,
      participantKey: st.participantKey,
      lane,
      tMs: st.atMs,
      stratum: p.value.stratum,
      type: p.value.type,
      attitude: st.attitude,
      strength: st.strength,
      source: st.source,
    });
  }

  const relations: ArcRelation[] = [];
  for (const t of s.relations.values()) {
    if (!isLive(t) || !ATTACKS.has(t.value.type)) continue;
    const fl = holder.get(t.value.fromId);
    const tl = holder.get(t.value.toId);
    if (fl === undefined || tl === undefined || fl === tl) continue;
    relations.push({ id: t.value.id, type: t.value.type, fromPid: t.value.fromId, toPid: t.value.toId, fromLane: fl, toLane: tl });
  }

  const { disputes, shared } = groundOverTime(stances, sideKeys);
  const cards = insightMoments(events, s);
  const { rounds, bands } = roundsOf(events, meta, endMs);

  const speaking: ArcModel['speaking'] = [];
  for (const id of s.utteranceOrder) {
    const u = s.utterances.get(id);
    if (u) speaking.push({ key: u.participantKey, startMs: u.startMs, endMs: u.endMs });
  }

  const changes: { tMs: number; dD: number; dS: number }[] = [];
  for (const d of disputes) {
    changes.push({ tMs: d.startMs, dD: 1, dS: 0 });
    if (d.endMs !== null) changes.push({ tMs: d.endMs, dD: -1, dS: 0 });
  }
  for (const x of shared) {
    changes.push({ tMs: x.startMs, dD: 0, dS: 1 });
    if (x.endMs !== null) changes.push({ tMs: x.endMs, dD: 0, dS: -1 });
  }
  changes.sort((a, b) => a.tMs - b.tMs);
  const series: ArcModel['series'] = [{ tMs: 0, disputes: 0, shared: 0 }];
  for (const c of changes) {
    const last = series.at(-1)!;
    const next = { tMs: c.tMs, disputes: last.disputes + c.dD, shared: last.shared + c.dS };
    if (last.tMs === c.tMs) series[series.length - 1] = next;
    else series.push(next);
  }

  return { sideKeys, marks, relations, disputes, shared, cards, rounds, bands, speaking, series, endMs };
}

export function countsAt(series: ArcModel['series'], tMs: number): { disputes: number; shared: number } {
  let cur = series[0] ?? { disputes: 0, shared: 0 };
  for (const p of series) {
    if (p.tMs > tMs) break;
    cur = p;
  }
  return { disputes: cur.disputes, shared: cur.shared };
}
