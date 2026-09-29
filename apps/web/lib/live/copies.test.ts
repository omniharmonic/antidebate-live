import { describe, expect, it } from 'vitest';
import { COPY_WAIT_MS, CopyFilter, type Cut } from './copies';

const cut = (channel: string, startMs: number, endMs: number, margin: number): Cut => ({ channel, startMs, endMs, margin });

describe('CopyFilter', () => {
  it('louder cut first: the quieter copy of the same speech is dropped', () => {
    const f = new CopyFilter<Cut>();
    expect(f.offer(cut('L', 0, 2000, 3))).toHaveLength(1);
    expect(f.offer(cut('R', 100, 1900, -3))).toEqual([]);
    expect(f.flush()).toEqual([]);
  });
  it('quieter cut first: it waits, and is dropped when the louder copy arrives', () => {
    const f = new CopyFilter<Cut>();
    expect(f.offer(cut('R', 100, 1800, -3))).toEqual([]);
    expect(f.offer(cut('L', 0, 2000, 3))).toHaveLength(1);
    expect(f.release(10_000)).toEqual([]);
  });
  it('a quieter cut with no louder copy runs after the wait', () => {
    const f = new CopyFilter<Cut>();
    const c = cut('R', 0, 1000, -2);
    f.offer(c);
    expect(f.release(1000 + COPY_WAIT_MS - 1)).toEqual([]);
    expect(f.release(1000 + COPY_WAIT_MS)).toEqual([c]);
  });
  it('two people talking over each other, each louder on their own mic, are both kept', () => {
    const f = new CopyFilter<Cut>();
    expect(f.offer(cut('L', 0, 2000, 2))).toHaveLength(1);
    expect(f.offer(cut('R', 500, 2500, 2))).toHaveLength(1);
  });
  it('a short overlap (under half) is not the same speech', () => {
    const f = new CopyFilter<Cut>();
    f.offer(cut('L', 0, 2000, 3));
    const r = cut('R', 1500, 3500, -3);
    f.offer(r);
    expect(f.release(3500 + COPY_WAIT_MS)).toEqual([r]);
  });
});
