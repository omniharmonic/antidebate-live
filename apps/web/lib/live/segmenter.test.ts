import { describe, expect, it } from 'vitest';
import { Segmenter, type Segmented } from './segmenter';

const FRAME = 320;
const tone = (amp: number) => {
  const f = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) f[i] = amp * Math.sin((2 * Math.PI * 220 * i) / 16_000);
  return f;
};
const quiet = () => {
  const f = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) f[i] = 0.0005 * Math.sin(i);
  return f;
};

/** Feeds `plan[channel](frameIndex)` for n frames on every channel, in step. */
function feed(s: Segmenter, n: number, plan: Record<string, (i: number) => Float32Array>) {
  for (let i = 0; i < n; i++) for (const [c, f] of Object.entries(plan)) s.push(c, f(i), i * 20);
}

describe('Segmenter', () => {
  it('cuts an utterance on its channel, offset into session time, with every channel level and its wall end', () => {
    const out: Segmented[] = [];
    const s = new Segmenter({ channels: ['d0c0', 'd0c1'], offsetMs: 60_000, wallStartMs: 1_000_000, onUtterance: (x) => out.push(x) });
    const speaking = (i: number) => i >= 100 && i < 200;
    feed(s, 300, { d0c0: (i) => (speaking(i) ? tone(0.3) : quiet()), d0c1: (i) => (speaking(i) ? tone(0.03) : quiet()) });
    // Input 2 also cuts its bleed copy (the attributor drops it); input 1's utterance is the one to check.
    const mine = out.filter((x) => x.channel === 'd0c0');
    expect(mine).toHaveLength(1);
    const [u] = mine as [Segmented];
    expect(u.channel).toBe('d0c0');
    expect(u.u.startMs).toBe(61_800); // 200 ms pre-roll
    expect(u.u.endMs).toBeGreaterThan(64_000);
    expect(u.endedAtWallMs).toBe(1_000_000 + (u.u.endMs - 60_000));
    expect(u.rms.d0c0! - u.rms.d0c1!).toBeGreaterThan(15);
    expect(u.overlap).toBe(false);
  });

  it('ignores channels outside the setup', () => {
    const out: Segmented[] = [];
    const s = new Segmenter({ channels: ['d0c0'], offsetMs: 0, wallStartMs: 0, onUtterance: (x) => out.push(x) });
    feed(s, 300, { d0c1: (i) => (i >= 100 && i < 200 ? tone(0.3) : quiet()) });
    expect(out).toEqual([]);
  });

  it('marks overlap when another channel carried its own speech at a similar level, not a bleed copy', () => {
    const out: Segmented[] = [];
    const s = new Segmenter({ channels: ['a', 'b'], offsetMs: 0, wallStartMs: 0, onUtterance: (x) => out.push(x) });
    // b speaks 100–160, a speaks 120–220: both loud on their own mic.
    feed(s, 320, { a: (i) => (i >= 120 && i < 220 ? tone(0.3) : quiet()), b: (i) => (i >= 100 && i < 160 ? tone(0.3) : quiet()) });
    const a = out.find((x) => x.channel === 'a')!;
    expect(a.overlap).toBe(true);

    const bleed: Segmented[] = [];
    const t = new Segmenter({ channels: ['a', 'b'], offsetMs: 0, wallStartMs: 0, onUtterance: (x) => bleed.push(x) });
    // Only a speaks; b hears it 20 dB down (a bleed copy that its VAD still cuts).
    feed(t, 320, { a: (i) => (i >= 100 && i < 200 ? tone(0.3) : quiet()), b: (i) => (i >= 100 && i < 180 ? tone(0.03) : quiet()) });
    expect(bleed.find((x) => x.channel === 'a')!.overlap).toBe(false);
  });

  it('reports which channels spoke in the last second and a half', () => {
    const s = new Segmenter({ channels: ['a', 'b'], offsetMs: 0, wallStartMs: 0, onUtterance: () => {} });
    feed(s, 300, { a: (i) => (i >= 100 && i < 200 ? tone(0.3) : quiet()), b: () => quiet() });
    const end = 300 * 20;
    expect(s.active(end)).toEqual({ a: true, b: false });
    expect(s.active(end + 5_000)).toEqual({ a: false, b: false });
  });
});
