import { describe, expect, it } from 'vitest';
import type { Relation, Stance, Stratum } from '@adl/ontology';
import { commitmentStores, commonGround, disagreements } from './commitments';
import { rankCruxes } from './crux';
import { addUndirected, shortestPath, type Adjacency } from './paths';

const st = (participantKey: string, propositionId: string, attitude: Stance['attitude'], atMs = 0, strength: Stance['strength'] = 'confident', source: Stance['source'] = 'stated'): Stance => ({
  id: `${participantKey}:${propositionId}:${atMs}`,
  participantKey,
  propositionId,
  atMs,
  attitude,
  strength,
  source,
});
const rel = (type: Relation['type'], fromId: string, toId: string, inferred = false): Relation => ({ id: `${type}:${fromId}:${toId}`, type, fromId, toId, inferred, status: 'live_provisional' });

describe('commitment stores', () => {
  it('uses the latest stance and ignores inferred ones', () => {
    const stores = commitmentStores([st('A', 'p1', 'rejects', 0), st('A', 'p1', 'accepts', 10), st('B', 'p2', 'accepts', 0, 'confident', 'inferred')]);
    expect(stores.get('A')?.get('p1')?.attitude).toBe('accepts');
    expect(stores.get('B')).toBeUndefined();
  });
  it('finds disagreements and common ground', () => {
    const stores = commitmentStores([st('A', 'license', 'accepts'), st('B', 'license', 'rejects'), st('A', 'audits', 'accepts'), st('B', 'audits', 'accepts')]);
    expect(disagreements(stores).map((d) => d.propositionId)).toEqual(['license']);
    expect(commonGround(stores, ['A', 'B'])).toEqual(['audits']);
  });
});

describe('crux ranking (ONTOLOGY §4.2 worked example)', () => {
  // A: licensing ← (concentration is safer than self-regulation); B rejects both.
  const stances = [
    st('A', 'license', 'accepts'),
    st('B', 'license', 'rejects'),
    st('A', 'agency_ok', 'accepts'),
    st('B', 'agency_ok', 'rejects'),
    st('A', 'mandate', 'accepts'),
    st('B', 'mandate', 'rejects'),
  ];
  const relations = [rel('supports', 'agency_ok', 'license'), rel('supports', 'agency_ok', 'mandate')];
  const strata = new Map<string, Stratum>([
    ['license', 'praxis'],
    ['mandate', 'praxis'],
    ['agency_ok', 'axiology'],
  ]);
  it('ranks the shared upstream disagreement first', () => {
    const ranked = rankCruxes({ disagreements: disagreements(commitmentStores(stances)), relations, strata });
    expect(ranked[0]?.propositionId).toBe('agency_ok');
    expect(ranked[0]?.forDisagreements.length).toBe(3);
  });
});

describe('shortestPath', () => {
  it('finds the lightest path', () => {
    const adj: Adjacency = new Map();
    addUndirected(adj, 'a', 'b', 1);
    addUndirected(adj, 'b', 'c', 1);
    addUndirected(adj, 'a', 'c', 5);
    expect(shortestPath(adj, 'a', 'c')).toEqual({ path: ['a', 'b', 'c'], distance: 2 });
  });
});
