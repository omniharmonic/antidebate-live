import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// The helper is a classic-worker script (no module syntax); evaluate it the way the worker's global scope does.
type Swap = <T>(sd: { setConfig(c: unknown): void }, clustering: unknown, restore: unknown, fn: () => T) => T;
const src = readFileSync(join(__dirname, '../../public/sherpa/cluster-swap.js'), 'utf8');
const mod = { exports: {} as { withClustering?: Swap } };
new Function('self', 'module', src)({}, mod);
const withClustering = mod.exports.withClustering!;

describe('withClustering', () => {
  it('applies the clustering for the call, then restores and returns the result', () => {
    const calls: unknown[] = [];
    const sd = { setConfig: (c: unknown) => calls.push(c) };
    expect(withClustering(sd, { numClusters: 3 }, { numClusters: -1 }, () => 'out')).toBe('out');
    expect(calls).toEqual([{ clustering: { numClusters: 3 } }, { clustering: { numClusters: -1 } }]);
  });

  it('restores the recording clustering when the work throws, and the error propagates', () => {
    const calls: unknown[] = [];
    const sd = { setConfig: (c: unknown) => calls.push(c) };
    const fn = vi.fn(() => { throw new Error('process failed'); });
    expect(() => withClustering(sd, { numClusters: 3 }, { numClusters: -1 }, fn)).toThrow('process failed');
    expect(calls).toEqual([{ clustering: { numClusters: 3 } }, { clustering: { numClusters: -1 } }]);
  });
});
