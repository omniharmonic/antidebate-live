/**
 * The approved map, compiled from SessionState for L3/L4 and for code checks.
 * Only approved (or released) items count; merged and rejected items never do.
 * Disagreements come from stances on shared propositions (ONTOLOGY §4.1); "clashes"
 * add cross-speaker attack relations (rebuts / undercuts / undermines) between
 * propositions each side accepts, marked as such because the ontology defines
 * disagreement over shared propositions only.
 */
import type { SessionState } from '@adl/core';
import { commitmentStores, commonGround, disagreements, rankCruxes, type Disagreement } from '@adl/graph';
import type { Proposition, Relation, Stance, Stratum } from '@adl/ontology';

export interface MapView {
  debaters: { key: string; displayName: string }[];
  props: Map<string, Proposition>;
  stances: Stance[];
  relations: Relation[];
  /** propositionId → participantKey → latest stance */
  holders: Map<string, Map<string, Stance>>;
  disagreements: Disagreement[];
  clashes: Disagreement[];
  commonGround: string[];
  cruxCandidates: { propositionId: string; score: number; forDisagreements: string[]; basis: 'stated' | 'clash' }[];
  /** stanceId → verbatim quote of its ADU */
  quotes: Map<string, string>;
}

const live = (state: string) => state === 'approved' || state === 'released';
const ATTACKS = new Set(['rebuts', 'undercuts', 'undermines']);
const accepts = (s: Stance | undefined) => s !== undefined && (s.attitude === 'accepts' || s.attitude === 'accepts_conditionally');

export function buildMapView(s: SessionState): MapView {
  const debaters = s.participants.filter((p) => p.role === 'debater').map(({ key, displayName }) => ({ key, displayName }));
  const debaterKeys = new Set(debaters.map((d) => d.key));
  const props = new Map<string, Proposition>();
  for (const p of s.propositions.values()) if (live(p.state)) props.set(p.value.id, p.value);
  const stances = [...s.stances.values()]
    .filter((t) => live(t.state) && props.has(t.value.propositionId) && debaterKeys.has(t.value.participantKey))
    .map((t) => t.value);
  const relations = [...s.relations.values()].filter((t) => live(t.state) && props.has(t.value.fromId) && props.has(t.value.toId)).map((t) => t.value);

  const stores = commitmentStores(stances);
  const holders = new Map<string, Map<string, Stance>>();
  for (const [key, store] of stores) for (const [pid, st] of store) {
    if (!holders.has(pid)) holders.set(pid, new Map());
    holders.get(pid)!.set(key, st);
  }
  const dis = disagreements(stores);

  // Clashes: X accepts `from`, Y accepts `to`, and `from` attacks `to`.
  const clashes: Disagreement[] = [];
  const seen = new Set(dis.map((d) => d.propositionId));
  for (const r of relations) {
    if (!ATTACKS.has(r.type)) continue;
    for (const [x, sx] of holders.get(r.fromId) ?? []) {
      if (!accepts(sx)) continue;
      for (const [y, sy] of holders.get(r.toId) ?? []) {
        if (x === y || !accepts(sy) || seen.has(r.toId)) continue;
        const pair = [x, y].sort() as [string, string];
        clashes.push({ id: `clash:${r.toId}:${pair[0]}:${pair[1]}`, propositionId: r.toId, participants: pair });
        seen.add(r.toId);
      }
    }
  }

  const strata = new Map<string, Stratum>([...props.values()].map((p) => [p.id, p.stratum]));
  const stated = rankCruxes({ disagreements: dis, relations, strata, topK: 6 }).map((c) => ({ ...c, basis: 'stated' as const }));
  const statedIds = new Set(stated.map((c) => c.propositionId));
  const fromClash = rankCruxes({ disagreements: clashes, relations, strata, topK: 6 })
    .filter((c) => !statedIds.has(c.propositionId))
    .map((c) => ({ ...c, basis: 'clash' as const }));

  const quotes = new Map<string, string>();
  for (const st of stances) {
    const adu = st.viaAduId ? s.adus.get(st.viaAduId)?.value : undefined;
    if (adu) quotes.set(st.id, adu.spans.map((x) => x.quote).join(' … '));
  }

  return {
    debaters,
    props,
    stances,
    relations,
    holders,
    disagreements: dis,
    clashes,
    commonGround: debaters.length >= 2 ? commonGround(stores, debaters.map((d) => d.key)) : [],
    cruxCandidates: [...stated, ...fromClash].slice(0, 8),
    quotes,
  };
}

/** Compact text rendering for prompts. Ids are kept so the model can cite them. */
export function renderMap(v: MapView, opts: { onlyIds?: Set<string> } = {}): string {
  const name = new Map(v.debaters.map((d) => [d.key, d.displayName]));
  const lines: string[] = [];
  for (const p of v.props.values()) {
    if (opts.onlyIds && !opts.onlyIds.has(p.id)) continue;
    const hs = [...(v.holders.get(p.id) ?? new Map<string, Stance>()).values()]
      .map((s) => `${name.get(s.participantKey) ?? s.participantKey} ${s.attitude} (${s.strength}${s.source === 'implied_by_act' ? ', implied' : ''})`)
      .join('; ');
    lines.push(`${p.id} [${p.type}/${p.stratum}] ${p.canonical}${hs ? ` — ${hs}` : ''}`);
  }
  return lines.join('\n');
}

/**
 * A bounded slice of the map for L3/L4 prompts, so input stays flat as a debate
 * grows (evals/results.md 2026-09-28: whole-map prompts dominated cost). Always keeps
 * everything that is structurally live (disagreements, clashes, shared ground, crux
 * candidates, `must`), then fills with the newest propositions up to `limit`.
 */
export function focusIds(v: MapView, must: Iterable<string> = [], limit = 70): Set<string> {
  const keep = new Set<string>();
  const add = (id: string) => {
    if (v.props.has(id)) keep.add(id);
  };
  for (const d of [...v.disagreements, ...v.clashes]) add(d.propositionId);
  for (const r of v.relations) {
    if (['rebuts', 'undercuts', 'undermines'].includes(r.type)) {
      add(r.fromId);
      add(r.toId);
    }
  }
  v.commonGround.forEach(add);
  v.cruxCandidates.forEach((c) => add(c.propositionId));
  for (const id of must) add(id);
  const newest = [...v.props.keys()].reverse(); // Map keeps insertion (= event) order
  for (const id of newest) {
    if (keep.size >= limit) break;
    keep.add(id);
  }
  return keep;
}

const STOP = new Set('a an the of to in on for and or but is are be been being was were will would should could can may might that this these those it its as at by with from than then so if not no do does did have has had their there they them we our you your i he she his her who which what whether about into over under more most less least very just also only both each other such any all some'.split(' '));
const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));

/**
 * For each new proposition, the most similar propositions held only by *other*
 * speakers, anywhere in the map (word overlap; no model). L3 sees these as merge
 * candidates, so paraphrase merges across speakers aren't limited to the recent
 * window. This is what lets shared ground and disagreements form.
 */
export function crossSpeakerCandidates(v: MapView, newIds: Iterable<string>, perNew = 3, minScore = 0.25): Set<string> {
  const holdersOf = (id: string) => new Set([...(v.holders.get(id)?.keys() ?? [])]);
  const vocab = new Map([...v.props.values()].map((p) => [p.id, words(p.canonical)]));
  const out = new Set<string>();
  for (const id of newIds) {
    const mine = holdersOf(id);
    const w = vocab.get(id);
    if (!w || w.size === 0) continue;
    const scored: [string, number][] = [];
    for (const [other, ow] of vocab) {
      if (other === id) continue;
      const hs = holdersOf(other);
      if (hs.size === 0 || [...hs].every((k) => mine.has(k))) continue; // only other speakers' claims
      let inter = 0;
      for (const x of w) if (ow.has(x)) inter += 1;
      const score = inter / Math.min(w.size, ow.size);
      if (score >= minScore) scored.push([other, score]);
    }
    scored.sort((a, b) => b[1] - a[1]).slice(0, perNew).forEach(([o]) => out.add(o));
  }
  return out;
}
