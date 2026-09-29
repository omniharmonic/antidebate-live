/**
 * Data model for the spatial explorer (UX §6, DIRECTION §5). Everything here is
 * derived from the event log; layout is deterministic (hash of the proposition id)
 * so nothing reshuffles as evidence arrives. The only movement is a proposition
 * changing column when a second participant takes a stance on it.
 *
 * Axes
 *   Y  stratum: praxis (top) → empirical → axiology → epistemology → ontology (base);
 *      higher-ground candidates above praxis.
 *   X  who holds it at the playhead: side A only on the left, side B only on the
 *      right, both near the centre. Propositions in a cross-side attack
 *      (rebuts / undercuts / undermines) sit in the inner band of their side.
 *      Spacing inside a band is layout only.
 *   Z  time the proposition was first asserted (first stance), early at the back.
 */
import type { DomainEvent, SessionState } from '@adl/core';
import { STRATUM_DEPTH, type Proposition, type Stance, type Stratum } from '@adl/ontology';
import type { CruxCard, HigherGroundCard, SharedCard } from '@adl/ontology';
import { commonGround, disagreements, type CommitmentStores } from '@adl/graph';
import { cockpitVisible, isLive, roundsOf, type Band, type RoundMark, type SessionMeta } from './derive';

export const STRATA: Stratum[] = ['praxis', 'empirical', 'axiology', 'epistemology', 'ontology'];
export const STRATUM_GLOSS: Record<Stratum, string> = {
  praxis: 'What to do',
  empirical: 'What is, what will be',
  axiology: 'What matters',
  epistemology: 'How we know',
  ontology: 'What exists',
};
export const STRATUM_LABEL: Record<Stratum, string> = {
  praxis: 'Praxis',
  empirical: 'Empirical',
  axiology: 'Axiology',
  epistemology: 'Epistemology',
  ontology: 'Ontology',
};

const ATTACKS = new Set(['rebuts', 'undercuts', 'undermines']);

export interface SNode {
  pid: string;
  canonical: string;
  type: Proposition['type'];
  stratum: Stratum;
  /** First stated/act-implied stance by a debater (media ms). */
  firstMs: number;
  /** Debater stances (stated or implied by an act), media order. */
  stances: Stance[];
  h1: number;
  h2: number;
  /** Display alias: order of first assertion, 1-based. */
  n: number;
}

export interface SRel {
  id: string;
  type: string;
  from: string;
  to: string;
  atMs: number;
  inferred: boolean;
}

export interface SCrux {
  id: string;
  tMs: number;
  pid: string;
  body: CruxCard;
}

export interface SHg {
  id: string;
  tMs: number;
  body: HigherGroundCard;
  h1: number;
}

export interface SShared {
  tMs: number;
  body: SharedCard;
}

export interface SpatialModel {
  nodes: SNode[];
  byId: Map<string, SNode>;
  relations: SRel[];
  cruxes: SCrux[];
  hgs: SHg[];
  shared: SShared[];
  rounds: RoundMark[];
  bands: Band[];
  endMs: number;
  sideKeys: [string, string | null] | null;
  /** Live propositions no debater holds a stance on (steelman/attribution content, moderator lines). */
  unheld: number;
  unheldNodes: { pid: string; canonical: string; type: Proposition['type']; stratum: Stratum; atMs: number }[];
}

/** FNV-1a → [0, 1). Stable across runs and machines. */
export function hash01(s: string, salt = 0): number {
  let h = 0x811c9dc5 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 100_000) / 100_000;
}

export function buildSpatialModel(s: SessionState, events: readonly DomainEvent[], meta: SessionMeta, endMs: number): SpatialModel {
  const [pa, pb] = meta.sides;
  const sideKeys: SpatialModel['sideKeys'] = pa ? [pa.key, pb?.key ?? null] : null;
  const debaterKeys = new Set([pa?.key, pb?.key].filter((k): k is string => Boolean(k)));

  // event times for items that carry no media time of their own
  const relAt = new Map<string, number>();
  const insightAt = new Map<string, number>();
  const propAt = new Map<string, number>();
  for (const e of events) {
    if (e.type === 'proposition.proposed') {
      if (!propAt.has(e.payload.proposition.id)) propAt.set(e.payload.proposition.id, e.mediaMs);
    } else if (e.type === 'relation.proposed') relAt.set(e.payload.relation.id, e.mediaMs);
    else if (e.type === 'insight.proposed' && !insightAt.has(e.payload.insight.id)) insightAt.set(e.payload.insight.id, e.mediaMs);
  }

  const stancesBy = new Map<string, Stance[]>();
  for (const t of s.stances.values()) {
    if (!isLive(t)) continue;
    const st = t.value;
    if (st.source === 'inferred' || !debaterKeys.has(st.participantKey)) continue;
    const arr = stancesBy.get(st.propositionId);
    if (arr) arr.push(st);
    else stancesBy.set(st.propositionId, [st]);
  }

  const nodes: SNode[] = [];
  const unheldNodes: SpatialModel['unheldNodes'] = [];
  let unheld = 0;
  for (const t of s.propositions.values()) {
    if (!isLive(t)) continue;
    const p = t.value;
    const sts = stancesBy.get(p.id);
    if (!sts || sts.length === 0) {
      unheld++;
      unheldNodes.push({ pid: p.id, canonical: p.canonical, type: p.type, stratum: p.stratum, atMs: propAt.get(p.id) ?? 0 });
      continue;
    }
    sts.sort((a, b) => a.atMs - b.atMs);
    nodes.push({ pid: p.id, canonical: p.canonical, type: p.type, stratum: p.stratum, firstMs: sts[0]!.atMs, stances: sts, h1: hash01(p.id, 1), h2: hash01(p.id, 2), n: 0 });
  }
  nodes.sort((a, b) => a.firstMs - b.firstMs || a.pid.localeCompare(b.pid));
  nodes.forEach((n, i) => (n.n = i + 1));
  const byId = new Map(nodes.map((n) => [n.pid, n]));

  const relations: SRel[] = [];
  for (const t of s.relations.values()) {
    if (!isLive(t)) continue;
    const r = t.value;
    if (!byId.has(r.fromId) || !byId.has(r.toId)) continue;
    const a = byId.get(r.fromId)!;
    const b = byId.get(r.toId)!;
    relations.push({ id: r.id, type: r.type, from: r.fromId, to: r.toId, atMs: Math.max(relAt.get(r.id) ?? 0, a.firstMs, b.firstMs), inferred: Boolean(r.inferred) });
  }

  const cruxes: SCrux[] = [];
  const hgs: SHg[] = [];
  const shared: SShared[] = [];
  const hgTexts = new Set<string>();
  for (const t of s.insights.values()) {
    if (!cockpitVisible(t)) continue;
    const i = t.value;
    const tMs = insightAt.get(i.id) ?? 0;
    if (i.kind === 'crux') {
      const body = i.body as unknown as CruxCard;
      if (byId.has(body.propositionId)) cruxes.push({ id: i.id, tMs, pid: body.propositionId, body });
    } else if (i.kind === 'higher_ground') {
      const body = i.body as unknown as HigherGroundCard;
      const key = body.text.trim().toLowerCase();
      if (hgTexts.has(key)) continue;
      hgTexts.add(key);
      hgs.push({ id: i.id, tMs, body, h1: hash01(i.id, 3) });
    } else if (i.kind === 'shared') {
      shared.push({ tMs, body: i.body as unknown as SharedCard });
    }
  }
  const byT = <T extends { tMs: number }>(a: T, b: T) => a.tMs - b.tMs;
  cruxes.sort(byT);
  hgs.sort(byT);
  shared.sort(byT);

  const { rounds, bands } = roundsOf(events, meta, endMs);
  unheldNodes.sort((a, b) => a.atMs - b.atMs);
  return { nodes, byId, relations, cruxes, hgs, shared, rounds, bands, endMs, sideKeys, unheld, unheldNodes };
}

/* ---------- arrangement at the playhead ---------- */

export type Column = 'a' | 'b' | 'both';
export type Tone = 'a' | 'b' | 'shared' | 'disputed' | 'both';

export interface Placed {
  node: SNode;
  column: Column;
  tone: Tone;
  /** Held only by one side and that side rejects or suspends it: drawn as a ring. */
  ring: boolean;
  clash: boolean;
  latest: { a?: Stance; b?: Stance };
  x: number;
  y: number;
  z: number;
}

export interface PlacedHg extends SHg {
  x: number;
  z: number;
}

export interface Arrangement {
  placed: Placed[];
  byId: Map<string, Placed>;
  /** Cross-side attacks among visible propositions. */
  clashes: SRel[];
  crux: SCrux | null;
  hgs: PlacedHg[];
  hg: PlacedHg | null;
  converging: { ids: [string, string]; relationId: string }[];
  counts: { propositions: number; disputed: number; shared: number };
  zFrom: number;
  zTo: number;
}

/* World geometry (units). */
export const GEOM = {
  halfWidth: 10,
  depth: 36,
  planeGap: 3.2,
  centre: 1.1,
  inner: [2.1, 4.6] as [number, number],
  outer: [5.0, 10] as [number, number],
};

export function planeY(stratum: Stratum): number {
  return (4 - STRATUM_DEPTH[stratum]) * GEOM.planeGap;
}
export const HG_Y = 5 * GEOM.planeGap + 0.4;

export function windowRange(model: SpatialModel, tNow: number, win: 'full' | number | 'round'): [number, number] {
  if (win === 'full') return [0, Math.max(model.endMs, 1)];
  if (win === 'round') {
    const r = [...model.rounds].reverse().find((x) => x.startMs <= tNow);
    return r ? [r.startMs, Math.max(tNow, r.startMs + 60_000)] : [0, Math.max(tNow, 60_000)];
  }
  return [Math.max(0, tNow - win), Math.max(tNow, win)];
}

export function zOf(ms: number, range: [number, number]): number {
  const [a, b] = range;
  return -GEOM.depth / 2 + ((ms - a) / Math.max(1, b - a)) * GEOM.depth;
}

const acceptsLike = (st: Stance) => st.attitude === 'accepts' || st.attitude === 'accepts_conditionally' || st.attitude === 'accepts_for_argument';

export function arrangeAt(model: SpatialModel, tNow: number, range: [number, number]): Arrangement {
  const [ka, kb] = model.sideKeys ?? [null, null];
  const single = !kb;
  const visible = model.nodes.filter((n) => n.firstMs <= tNow && n.firstMs >= range[0]);

  // latest stance per side at the playhead
  const latestOf = (n: SNode) => {
    let a: Stance | undefined;
    let b: Stance | undefined;
    for (const st of n.stances) {
      if (st.atMs > tNow) break;
      if (st.participantKey === ka) a = st;
      else if (st.participantKey === kb) b = st;
    }
    return { a, b };
  };
  const latest = new Map(visible.map((n) => [n.pid, latestOf(n)]));

  const colOf = (pid: string): Column | null => {
    const l = latest.get(pid);
    if (!l) return null;
    return l.a && l.b ? 'both' : l.a ? 'a' : l.b ? 'b' : null;
  };

  const clashes: SRel[] = [];
  const clashIds = new Set<string>();
  for (const r of model.relations) {
    if (r.atMs > tNow || !ATTACKS.has(r.type)) continue;
    const ca = colOf(r.from);
    const cb = colOf(r.to);
    if (!ca || !cb) continue;
    if (ca === cb && ca !== 'both') continue;
    clashes.push(r);
    clashIds.add(r.from);
    clashIds.add(r.to);
  }

  let disputed = 0;
  let sharedN = 0;
  const placed: Placed[] = [];
  for (const n of visible) {
    const l = latest.get(n.pid)!;
    const column = colOf(n.pid);
    if (!column) continue;
    let tone: Tone = column === 'a' ? 'a' : column === 'b' ? 'b' : 'both';
    if (column === 'both' && ka && kb) {
      const stores: CommitmentStores = new Map([
        [ka, new Map([[n.pid, l.a!]])],
        [kb, new Map([[n.pid, l.b!]])],
      ]);
      if (disagreements(stores).length) tone = 'disputed';
      else if (commonGround(stores, [ka, kb]).length) tone = 'shared';
    }
    if (tone === 'disputed') disputed++;
    if (tone === 'shared') sharedN++;
    const held = column === 'a' ? l.a : column === 'b' ? l.b : undefined;
    const ring = Boolean(held && !acceptsLike(held));
    const clash = clashIds.has(n.pid);
    let x: number;
    if (single) x = -GEOM.halfWidth + n.h1 * GEOM.halfWidth * 2;
    else if (column === 'both') x = (n.h1 - 0.5) * 2 * GEOM.centre;
    else {
      const [lo, hi] = clash ? GEOM.inner : GEOM.outer;
      const mag = lo + n.h1 * (hi - lo);
      x = column === 'a' ? -mag : mag;
    }
    placed.push({ node: n, column, tone, ring, clash, latest: l, x, y: planeY(n.stratum), z: zOf(n.firstMs, range) });
  }

  const crux = [...model.cruxes].reverse().find((c) => c.tMs <= tNow && latest.has(c.pid)) ?? null;
  const hgs = model.hgs.filter((h) => h.tMs <= tNow && h.tMs >= range[0]).map((h) => ({ ...h, x: hgX(h), z: zOf(h.tMs, range) }));
  const hg = hgs.at(-1) ?? null;
  const sharedCard = [...model.shared].reverse().find((c) => c.tMs <= tNow);
  const byId = new Map(placed.map((p) => [p.node.pid, p]));
  const converging = (sharedCard?.body.converging ?? [])
    .filter((c) => byId.has(c.ids[0]!) && byId.has(c.ids[1]!))
    .map((c) => ({ ids: [c.ids[0]!, c.ids[1]!] as [string, string], relationId: c.relationId }));

  return {
    placed,
    byId,
    clashes,
    crux,
    hgs,
    hg,
    converging,
    counts: { propositions: placed.length, disputed, shared: sharedN },
    zFrom: zOf(range[0], range),
    zTo: zOf(Math.min(tNow, range[1]), range),
  };
}

/** x of a higher-ground candidate above the median. */
export function hgX(h: SHg): number {
  return (h.h1 - 0.5) * 2 * GEOM.centre;
}
