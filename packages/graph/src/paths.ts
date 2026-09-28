/**
 * Weighted shortest path, ported from Ontography `src/lib/graph/analytics.ts`
 * ("the shortest path between our beliefs"), generalized to any adjacency.
 */
export type Adjacency = Map<string, Array<{ to: string; weight: number }>>;

export function addUndirected(adj: Adjacency, a: string, b: string, weight: number): void {
  if (!adj.has(a)) adj.set(a, []);
  if (!adj.has(b)) adj.set(b, []);
  adj.get(a)!.push({ to: b, weight });
  adj.get(b)!.push({ to: a, weight });
}

/** Dijkstra with linear selection; debate graphs are small (hundreds of nodes). */
export function shortestPath(adj: Adjacency, from: string, to: string): { path: string[]; distance: number } | null {
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const visited = new Set<string>();
  for (;;) {
    let current: string | null = null;
    let best = Infinity;
    for (const [id, d] of dist) {
      if (!visited.has(id) && d < best) {
        best = d;
        current = id;
      }
    }
    if (current === null) return null;
    if (current === to) break;
    visited.add(current);
    for (const e of adj.get(current) ?? []) {
      const nd = best + e.weight;
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        prev.set(e.to, current);
      }
    }
  }
  const path = [to];
  while (path[0] !== from) {
    const p = prev.get(path[0]!);
    if (!p) return null;
    path.unshift(p);
  }
  return { path, distance: dist.get(to)! };
}
