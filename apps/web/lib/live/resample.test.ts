import { describe, expect, it } from 'vitest';
import { createResampler } from './resample';

function run(inRate: number, seconds = 1, freq = 440) {
  const r = createResampler(inRate, 16000);
  const n = Math.round(inRate * seconds);
  const sig = Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * freq * i) / inRate));
  const out: number[] = [];
  for (let i = 0; i < n; i += 128) out.push(...r.push(sig.subarray(i, Math.min(n, i + 128))));
  return out;
}

describe.each([48000, 44100])('createResampler %i -> 16000', (rate) => {
  const out = run(rate);
  it('emits no NaN', () => expect(out.some((x) => Number.isNaN(x))).toBe(false));
  it('emits about one second of samples', () => expect(Math.abs(out.length - 16000)).toBeLessThanOrEqual(1));
  it('preserves the amplitude of a 440 Hz tone', () => {
    const peak = Math.max(...out.slice(100).map(Math.abs));
    expect(Math.abs(peak - 0.5) / 0.5).toBeLessThan(0.05);
  });
});
