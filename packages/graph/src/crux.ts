/**
 * Crux ranking (ONTOLOGY §4.2, ARCHITECTURE §3.5). A crux candidate C for a
 * disagreement on P is itself disputed and lies upstream of P (via `supports`
 * or `presupposes`). Its score counts how many disagreements depend on it,
 * weighted by stratum depth and discounted for inferred links.
 */
import type { Relation, Stratum } from '@adl/ontology';
import { STRATUM_DEPTH } from '@adl/ontology';
import type { Disagreement } from './commitments';

export interface CruxCandidate {
  propositionId: string;
  score: number;
  forDisagreements: string[];
}

/** upstream[x] = nodes that ground x, with link confidence (stated 1.0, inferred 0.5). */
function upstreamIndex(relations: Iterable<Relation>): Map<string, Array<{ from: string; conf: number }>> {
  const idx = new Map<string, Array<{ from: string; conf: number }>>();
  const push = (target: string, from: string, conf: number) => {
    if (!idx.has(target)) idx.set(target, []);
    idx.get(target)!.push({ from, conf });
  };
  for (const r of relations) {
    const conf = r.inferred ? 0.5 : 1;
    if (r.type === 'supports') push(r.toId, r.fromId, conf);
    // presupposes: assertion(from) presupposes presupposed(to) → the presupposed grounds the assertion
    if (r.type === 'presupposes') push(r.fromId, r.toId, conf);
  }
  return idx;
}

/** All ancestors of `start` with the best path confidence (product of link confidences). */
function ancestors(start: string, up: Map<string, Array<{ from: string; conf: number }>>, maxDepth = 6): Map<string, number> {
  const best = new Map<string, number>();
  const stack: Array<{ id: string; conf: number; d: number }> = [{ id: start, conf: 1, d: 0 }];
  while (stack.length) {
    const { id, conf, d } = stack.pop()!;
    if (d >= maxDepth) continue;
    for (const { from, conf: c } of up.get(id) ?? []) {
      const nc = conf * c;
      if (nc < 0.5 || from === start) continue; // at most one inferred link; cycles add no evidence
      if (nc > (best.get(from) ?? 0)) {
        best.set(from, nc);
        stack.push({ id: from, conf: nc, d: d + 1 });
      }
    }
  }
  return best;
}

export function rankCruxes(args: {
  disagreements: Disagreement[];
  relations: Iterable<Relation>;
  strata: ReadonlyMap<string, Stratum>;
  topK?: number;
}): CruxCandidate[] {
  const up = upstreamIndex(args.relations);
  const disputed = new Set(args.disagreements.map((d) => d.propositionId));
  const scores = new Map<string, { score: number; for: Set<string> }>();
  for (const d of args.disagreements) {
    // a disputed proposition is trivially its own crux candidate; upstream disputes outrank it
    const anc = ancestors(d.propositionId, up);
    anc.set(d.propositionId, Math.max(anc.get(d.propositionId) ?? 0, 0.25));
    for (const [c, conf] of anc) {
      if (!disputed.has(c)) continue;
      const depth = STRATUM_DEPTH[args.strata.get(c) ?? 'praxis'];
      const entry = scores.get(c) ?? { score: 0, for: new Set<string>() };
      entry.score += conf * (1 + 0.5 * depth);
      entry.for.add(d.id);
      scores.set(c, entry);
    }
  }
  return [...scores.entries()]
    .map(([propositionId, v]) => ({ propositionId, score: Math.round(v.score * 100) / 100, forDisagreements: [...v.for].sort() }))
    .sort((a, b) => b.score - a.score || a.propositionId.localeCompare(b.propositionId))
    .slice(0, args.topK ?? 5);
}
