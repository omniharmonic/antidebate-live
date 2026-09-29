import { describe, expect, it } from 'vitest';
import { EnergyVad, rmsDb } from './vad';

const frame = (amp: number) => Float32Array.from({ length: 320 }, (_, i) => amp * Math.sin(i / 3));

describe('EnergyVad', () => {
  it('cuts one utterance from speech between silences', () => {
    const v = new EnergyVad();
    const out = [];
    let t = 0;
    for (let i = 0; i < 150; i++, t += 20) { const r = v.push(frame(0.001), t); if (r) out.push(r); } // 3 s floor
    for (let i = 0; i < 100; i++, t += 20) { const r = v.push(frame(0.2), t); if (r) out.push(r); }  // 2 s speech
    for (let i = 0; i < 60; i++, t += 20) { const r = v.push(frame(0.001), t); if (r) out.push(r); }  // 1.2 s silence
    expect(out).toHaveLength(1);
    expect(out[0]!.startMs).toBe(3000);
    expect(out[0]!.endMs).toBeGreaterThanOrEqual(5000);
    expect(out[0]!.pcm.length).toBeGreaterThan(16_000 * 1.9);
  });
  it('ignores a click shorter than minSpeechMs', () => {
    const v = new EnergyVad();
    let t = 0, n = 0;
    for (let i = 0; i < 150; i++, t += 20) if (v.push(frame(0.001), t)) n++;
    for (let i = 0; i < 5; i++, t += 20) if (v.push(frame(0.5), t)) n++;
    for (let i = 0; i < 60; i++, t += 20) if (v.push(frame(0.001), t)) n++;
    expect(n).toBe(0);
  });
  it('closes a long monologue at maxUtteranceMs', () => {
    const v = new EnergyVad();
    const out = [];
    let t = 0;
    for (let i = 0; i < 150; i++, t += 20) v.push(frame(0.001), t);
    for (let i = 0; i < 900; i++, t += 20) { const r = v.push(frame(0.2), t); if (r) out.push(r); } // 18 s
    expect(out).toHaveLength(1);
    expect(out[0]!.endMs - out[0]!.startMs).toBe(15_000);
  });
  it('rmsDb of silence is very low', () => expect(rmsDb(new Float32Array(320))).toBeLessThan(-90));
});
