/**
 * Commitment stores, disagreement and common ground (ONTOLOGY §4.1, §4.3, §6).
 * Only stated or act-implied stances count; inferred stances never do.
 */
import type { Stance } from '@adl/ontology';
import { STRENGTH_RANK } from '@adl/ontology';

/** participantKey → propositionId → latest stance at or before `atMs`. */
export type CommitmentStores = Map<string, Map<string, Stance>>;

export function commitmentStores(stances: Iterable<Stance>, atMs = Infinity): CommitmentStores {
  const stores: CommitmentStores = new Map();
  const sorted = [...stances].filter((s) => s.source !== 'inferred' && s.atMs <= atMs).sort((a, b) => a.atMs - b.atMs);
  for (const s of sorted) {
    if (!stores.has(s.participantKey)) stores.set(s.participantKey, new Map());
    stores.get(s.participantKey)!.set(s.propositionId, s);
  }
  return stores;
}

export interface Disagreement {
  id: string;
  propositionId: string;
  participants: [string, string];
}

const accepts = (s: Stance) => s.attitude === 'accepts' || s.attitude === 'accepts_conditionally';

function opposed(a: Stance, b: Stance): boolean {
  if (accepts(a) && b.attitude === 'rejects') return true;
  if (a.attitude === 'rejects' && accepts(b)) return true;
  // accepts vs suspends counts when the acceptor is at least confident (§4.1)
  if (accepts(a) && b.attitude === 'suspends') return STRENGTH_RANK[a.strength] >= STRENGTH_RANK.confident;
  if (a.attitude === 'suspends' && accepts(b)) return STRENGTH_RANK[b.strength] >= STRENGTH_RANK.confident;
  return false;
}

export function disagreements(stores: CommitmentStores): Disagreement[] {
  const keys = [...stores.keys()].sort();
  const out: Disagreement[] = [];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = stores.get(keys[i]!)!;
      const b = stores.get(keys[j]!)!;
      for (const [pid, sa] of a) {
        const sb = b.get(pid);
        if (sb && opposed(sa, sb)) out.push({ id: `dis:${pid}:${keys[i]}:${keys[j]}`, propositionId: pid, participants: [keys[i]!, keys[j]!] });
      }
    }
  }
  return out;
}

/** Propositions every listed participant accepts at strength ≥ leaning (§4.3). */
export function commonGround(stores: CommitmentStores, participants: string[]): string[] {
  const [first, ...rest] = participants;
  const firstStore = first ? stores.get(first) : undefined;
  if (!firstStore) return [];
  const result: string[] = [];
  for (const [pid, s] of firstStore) {
    if (!accepts(s) || STRENGTH_RANK[s.strength] < STRENGTH_RANK.leaning) continue;
    const all = rest.every((k) => {
      const o = stores.get(k)?.get(pid);
      return o !== undefined && accepts(o) && STRENGTH_RANK[o.strength] >= STRENGTH_RANK.leaning;
    });
    if (all) result.push(pid);
  }
  return result;
}
