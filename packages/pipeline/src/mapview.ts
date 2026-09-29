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
