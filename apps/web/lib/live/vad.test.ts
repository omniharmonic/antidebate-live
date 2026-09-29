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
    // 200 ms of pre-roll before the first speech frame, so a soft onset is not clipped.
    expect(out[0]!.startMs).toBe(2800);
    expect(out[0]!.pcm.length).toBe(((out[0]!.endMs - out[0]!.startMs) / 1000) * 16_000);
    expect(out[0]!.endMs).toBeGreaterThanOrEqual(5000);
    expect(out[0]!.pcm.length).toBeGreaterThan(16_000 * 1.9);
  });
  it('pre-roll never reaches back into the previous utterance', () => {
    const v = new EnergyVad();
    const out = [];
    let t = 0;
    for (let i = 0; i < 150; i++, t += 20) v.push(frame(0.001), t);
    // The first utterance closes after 700 ms of silence; speech resumes 60 ms later.
    for (const quietFrames of [38, 60]) {
      for (let i = 0; i < 50; i++, t += 20) { const r = v.push(frame(0.2), t); if (r) out.push(r); }
      for (let i = 0; i < quietFrames; i++, t += 20) { const r = v.push(frame(0.001), t); if (r) out.push(r); }
    }
    expect(out).toHaveLength(2);
    expect(out[1]!.startMs).toBeGreaterThanOrEqual(out[0]!.endMs);
  });
  it('ignores a click shorter than minSpeechMs', () => {
    const v = new EnergyVad();
    let t = 0, n = 0;
    for (let i = 0; i < 150; i++, t += 20) if (v.push(frame(0.001), t)) n++;
    for (let i = 0; i < 5; i++, t += 20) if (v.push(frame(0.5), t)) n++;
    for (let i = 0; i < 60; i++, t += 20) if (v.push(frame(0.001), t)) n++;
    expect(n).toBe(0);
  });
  it('keeps a long monologue with breath gaps, closing at maxUtteranceMs', () => {
    const v = new EnergyVad();
    const out = [];
    let t = 0;
    for (let i = 0; i < 150; i++, t += 20) v.push(frame(0.001), t);
    const start = t;
    let loudFrames = 0;
    for (let i = 0; i < 1500; i++, t += 20) { // 30 s: 750 ms speech, 150 ms gap
      const loud = (t - start) % 900 < 750;
      if (loud) loudFrames++;
      const r = v.push(frame(loud ? 0.2 : 0.001), t); if (r) out.push(r);
    }
    for (let i = 0; i < 60; i++, t += 20) { const r = v.push(frame(0.001), t); if (r) out.push(r); }
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out.some((u) => u.endMs - u.startMs === 15_000)).toBe(true);
    let covered = 0;
    for (let i = 0; i < 1500; i++) {
      const at = start + i * 20;
      if (i * 20 % 900 < 750 && out.some((u) => at >= u.startMs && at < u.endMs)) covered++;
    }
    expect(covered / loudFrames).toBeGreaterThanOrEqual(0.9);
  });
  it('recovers from a sustained +20 dB noise step instead of chaining max-length utterances', () => {
    const v = new EnergyVad();
    const out = [];
    let t = 0;
    for (let i = 0; i < 150; i++, t += 20) v.push(frame(0.001), t);
    const step = t;
    for (let i = 0; i < 3000; i++, t += 20) { const r = v.push(frame(0.01), t); if (r) out.push(r); } // 60 s of fan
    expect(out.length).toBeLessThanOrEqual(1);
    for (const u of out) expect(u.endMs).toBeLessThan(step + 6000);
  });
  it('rmsDb of silence is very low', () => expect(rmsDb(new Float32Array(320))).toBeLessThan(-90));
});
