import { describe, expect, it } from 'vitest';
import { calibrate, duplicates, gateEntry, gatePred, pooled, score, worstGate, type Calibration } from './score';

const ref: [number, number, string][] = [[0, 1000, 'A'], [1000, 2000, 'B'], [2000, 3000, 'UNK']];

describe('score', () => {
  it('counts right, wrong-auto, held and missed as shares of reference speech', () => {
    const r = score(ref, [
      { startMs: 0, endMs: 1000, participantKey: 'A', confidence: 0.95, pending: false },
      { startMs: 1000, endMs: 1500, participantKey: 'A', confidence: 0.95, pending: false },
      { startMs: 2000, endMs: 3000, participantKey: 'A', confidence: 0.6, pending: true },
    ], 0.85);
    expect(r.correct).toBeCloseTo(2 / 3, 2);
    expect(r.wrongAuto).toBeCloseTo(1 / 6, 2);
    expect(r.missed).toBeCloseTo(1 / 6, 2);
  });
  it('overlapping reference speakers: matching either one is correct', () => {
    const r = score([[0, 1000, 'A'], [0, 1000, 'B']], [{ startMs: 0, endMs: 1000, participantKey: 'B', confidence: 1, pending: false }], 0.85);
    expect(r.wrongAuto).toBe(0);
  });
  it('a line below the threshold is held, whatever it says; a pending line is held at every threshold', () => {
    const p = [
      { startMs: 0, endMs: 1000, participantKey: 'A', confidence: 0.9, pending: false },
      { startMs: 1000, endMs: 2000, participantKey: 'B', confidence: 1, pending: true },
    ];
    expect(score(ref, p, 0.85).correct).toBeCloseTo(1 / 3, 2);
    expect(score(ref, p, 0.95)).toMatchObject({ correct: 0, held: 2 / 3 });
    expect(score(ref, p, 0.99).wrongAuto).toBe(0);
  });
  it('reports wrong auto-accepts as a share of auto-accepted speech too (the precision view)', () => {
    const r = score([[0, 4000, 'A']], [
      { startMs: 0, endMs: 3000, participantKey: 'A', confidence: 0.95, pending: false },
      { startMs: 3000, endMs: 4000, participantKey: 'B', confidence: 0.95, pending: false },
    ], 0.85);
    expect(r.wrongAuto).toBeCloseTo(0.25, 5);
    expect(r.wrongAutoOfAuto).toBeCloseTo(0.25, 5);
    const half = score([[0, 4000, 'A']], [
      { startMs: 0, endMs: 1000, participantKey: 'A', confidence: 0.95, pending: false },
      { startMs: 1000, endMs: 2000, participantKey: 'B', confidence: 0.95, pending: false },
    ], 0.85);
    expect(half.wrongAuto).toBeCloseTo(0.25, 5);
    expect(half.wrongAutoOfAuto).toBeCloseTo(0.5, 5);
    expect(score([[0, 1000, 'A']], [], 0.85).wrongAutoOfAuto).toBe(0);
  });
  it('a held line is scored on its best guess: "held, guess wrong or missing" counts only a wrong or absent guess', () => {
    const r = score([[0, 2000, 'A']], [
      { startMs: 0, endMs: 1000, participantKey: 'A', confidence: 0.6, pending: true },
      { startMs: 1000, endMs: 2000, participantKey: 'UNK', confidence: 0.6, pending: true },
    ], 0.85);
    expect(r).toMatchObject({ held: 1, wrongHeld: 0.5 });
  });
  it('spans excluded from a run (enrollment audio) are not scored', () => {
    const run = { reference: [[0, 2000, 'A']] as [number, number, string][], predicted: [{ startMs: 1000, endMs: 2000, participantKey: 'B', confidence: 1, pending: false }], exclude: [[1000, 2000]] as [number, number][] };
    expect(pooled([run], 0.85)).toMatchObject({ wrongAuto: 0, missed: 1 });
  });
  it('an auto debater over audience speech is wrong-auto', () => {
    const r = score([[0, 1000, 'UNK']], [{ startMs: 0, endMs: 1000, participantKey: 'A', confidence: 1, pending: false }], 0.85);
    expect(r.wrongAuto).toBe(1);
  });
});

describe('calibrate', () => {
  it('falls back to host-confirms-all when no threshold is safe', () => {
    const bad = { reference: ref, predicted: [{ startMs: 0, endMs: 3000, participantKey: 'B', confidence: 1, pending: false }] };
    expect(calibrate([bad])).toMatchObject({ threshold: 0.99, hostConfirmsAll: true });
  });
  it('picks the lowest threshold whose pooled wrong-auto is at most 2%', () => {
    const run = {
      reference: [[0, 10000, 'A']] as [number, number, string][],
      predicted: [
        { startMs: 0, endMs: 9000, participantKey: 'A', confidence: 0.95, pending: false },
        { startMs: 9000, endMs: 10000, participantKey: 'B', confidence: 0.86, pending: false },
      ],
    };
    expect(calibrate([run], undefined, { lines: 1, speechMs: 1000, fixtures: 1, fixtureLines: 1 })).toMatchObject({ threshold: 0.88, hostConfirmsAll: false, insufficient: false });
  });
  // 250 auto-accepted 6 s lines by A (25 min), right, over matching reference speech.
  const big = (n: number, ms: number) => ({
    reference: Array.from({ length: n }, (_, i): [number, number, string] => [i * ms, (i + 1) * ms, 'A']),
    predicted: Array.from({ length: n }, (_, i) => ({ startMs: i * ms, endMs: (i + 1) * ms, participantKey: 'A', confidence: 0.95, pending: false })),
  });
  it('passes only with at least 200 auto-accepted lines and 20 minutes of auto-accepted speech (P3-R7)', () => {
    const c = calibrate([big(150, 6000), big(100, 6000)]);
    expect(c).toMatchObject({ threshold: 0.85, hostConfirmsAll: false, insufficient: false, sample: { autoLines: 250, autoSpeechMs: 1_500_000 } });
    expect(c.atThreshold.wrongAutoOfAuto).toBe(0);
  });
  it('a clean error bar on too small a sample is insufficient (P3-R7)', () => {
    expect(calibrate([big(150, 10_000)])).toMatchObject({ threshold: 0.85, hostConfirmsAll: false, insufficient: true, sample: { autoLines: 150 } });
    expect(calibrate([big(250, 3000)])).toMatchObject({ insufficient: true, sample: { autoLines: 250, autoSpeechMs: 750_000 } });
  });
  it('needs at least 2 fixtures with 25 auto-accepted lines each: one big fixture is not representative (P3-R10)', () => {
    const tiny = big(24, 6000);
    expect(calibrate([big(250, 6000), tiny])).toMatchObject({ insufficient: true, sample: { fixturesAtMin: 1 } });
    expect(calibrate([big(225, 6000), big(25, 6000)])).toMatchObject({ insufficient: false, sample: { autoLines: 250, fixturesAtMin: 2 } });
  });
  it('every fixture that auto-accepts must itself stay at or under 2%: a clean pool cannot hide a bad fixture (P3-R10)', () => {
    // 100 s of B wrongly auto-accepted at 0.9 in a 1000 s fixture (10%), inside a pool where it is under 2%.
    const bad = {
      reference: [[0, 1_000_000, 'A']] as [number, number, string][],
      predicted: [
        { startMs: 0, endMs: 900_000, participantKey: 'A', confidence: 0.99, pending: false },
        { startMs: 900_000, endMs: 1_000_000, participantKey: 'B', confidence: 0.9, pending: false },
      ],
    };
    const pool = [bad, big(500, 6000), big(250, 6000)];
    expect(pooled(pool, 0.85).wrongAuto).toBeLessThan(0.02);
    // At 0.85 and 0.88 the bad fixture is at 10%; at 0.9 too (the wrong line scores 0.9); at 0.92 it is clean.
    expect(calibrate(pool)).toMatchObject({ threshold: 0.92, hostConfirmsAll: false });
    const always = { ...bad, predicted: bad.predicted.map((p) => ({ ...p, confidence: 1 })) };
    expect(calibrate([always, big(500, 6000), big(250, 6000)])).toMatchObject({ hostConfirmsAll: true });
  });
});

describe('gatePred', () => {
  const base = { startMs: 0, endMs: 1000, participantKey: 'UNK', confidence: 0.84, pending: true };
  it('lifts only the voice-only cap: a line the lab flags capped is scored on its uncapped score and candidate', () => {
    expect(gatePred('mono-live', { ...base, candidate: 'A', capped: true, uncapped: 1 })).toMatchObject({ participantKey: 'A', confidence: 1, pending: false });
  });
  it('a line without the capped flag stays held, whatever its confidence', () => {
    expect(gatePred('mono-live', { ...base, candidate: 'A', uncapped: 1 })).toMatchObject({ participantKey: 'A', pending: true });
  });
  it('keeps lines pending for other reasons held at every threshold', () => {
    const noCandidate = gatePred('mono-live', { ...base, confidence: 0.6 });
    const lowScore = gatePred('mono-live', { ...base, confidence: 0.7, candidate: 'B' });
    for (const p of [noCandidate, lowScore]) {
      expect(p.pending).toBe(true);
      for (const t of [0.85, 0.99]) expect(score([[0, 1000, 'A']], [{ ...p, confidence: 1 }], t).wrongAuto).toBe(0);
    }
    expect(lowScore.participantKey).toBe('B');
  });
  it('leaves other setups as recorded (capped dead-mic lines in tracks stay held), naming a held line by its best guess', () => {
    const u = { ...base, candidate: 'A', capped: true, uncapped: 1 };
    expect(gatePred('bleed', u)).toMatchObject({ participantKey: 'A', confidence: 0.84, pending: true });
    expect(gatePred('bleed', { ...base, confidence: 0.9, pending: false, participantKey: 'B' })).toMatchObject({ participantKey: 'B', pending: false });
  });
});

describe('duplicates', () => {
  const line = (channel: string, startMs: number, endMs: number) => ({ startMs, endMs, channel });
  it('counts two lines on different channels overlapping more than half the shorter one', () => {
    expect(duplicates([line('d0c0', 0, 4000), line('d1c0', 500, 3000)])).toBe(1);
    expect(duplicates([line('d0c0', 0, 4000), line('d1c0', 3000, 6000)])).toBe(0);
  });
  it('the same channel is never a duplicate, and lines inside excluded spans are not counted', () => {
    expect(duplicates([line('d0c0', 0, 4000), line('d0c0', 1000, 3000)])).toBe(0);
    expect(duplicates([line('d0c0', 0, 4000), line('d1c0', 500, 3000)], [[0, 5000]])).toBe(0);
  });
});

describe('gateEntry (what report.ts writes to gate.json)', () => {
  const pass: Calibration = { threshold: 0.85, hostConfirmsAll: false, insufficient: false, atThreshold: { correct: 1, wrongAuto: 0, wrongHeld: 0, held: 0, missed: 0, wrongAutoOfAuto: 0 }, sample: { autoLines: 300, autoSpeechMs: 1_800_000, fixturesAtMin: 3 } };
  it('room passes only on enrollment disjoint from the scored audio (P3-R6)', () => {
    expect(gateEntry('room', pass, { disjointEnrollment: true })).toEqual({ threshold: 0.85, hostConfirmsAll: false });
    expect(gateEntry('room', pass, { disjointEnrollment: false })).toEqual({ threshold: 0.85, hostConfirmsAll: false, insufficient: true });
  });
  it('call is measured from the room mix, so it is insufficient even when the room mix passes (P3-R10)', () => {
    expect(gateEntry('call', pass, { disjointEnrollment: true })).toEqual({ threshold: 0.85, hostConfirmsAll: false, insufficient: true, measuredFrom: 'room-mix' });
  });
  it('tracks and recording are not held to the voice enrollment rule', () => {
    expect(gateEntry('tracks', pass, { disjointEnrollment: false })).toEqual({ threshold: 0.85, hostConfirmsAll: false });
    expect(gateEntry('recording', { ...pass, insufficient: true }, { disjointEnrollment: false })).toEqual({ threshold: 0.85, hostConfirmsAll: false, insufficient: true });
  });
});

describe('worstGate', () => {
  it('host-confirms-all beats any threshold; else the highest threshold, insufficient if any is', () => {
    expect(worstGate([{ threshold: 0.85, hostConfirmsAll: false }, { threshold: 0.92, hostConfirmsAll: false, insufficient: true }])).toEqual({ threshold: 0.92, hostConfirmsAll: false, insufficient: true });
    expect(worstGate([{ threshold: 0.92, hostConfirmsAll: false }, { threshold: 0.99, hostConfirmsAll: true }])).toEqual({ threshold: 0.99, hostConfirmsAll: true });
    expect(worstGate([{ threshold: 0.85, hostConfirmsAll: false }, { threshold: 0.88, hostConfirmsAll: false }])).toEqual({ threshold: 0.88, hostConfirmsAll: false });
  });
});
