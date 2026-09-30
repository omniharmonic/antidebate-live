import { describe, expect, it } from 'vitest';
import type { DomainEvent } from '@adl/core';
import { anchorClip, clipOf, lastSpans, linesFromEvents, nameVoices, parseWav, speechWords } from './scenario';

const RATE = 16_000;
const at = (ms: number) => (ms * RATE) / 1000;

describe('parseWav', () => {
  it('reads 16 kHz mono float WAV and skips extra chunks', () => {
    const samples = Float32Array.of(0.5, -0.25, 1);
    const chunk = (id: string, body: Uint8Array) => {
      const b = new Uint8Array(8 + body.length);
      b.set([...id].map((c) => c.charCodeAt(0)), 0);
      new DataView(b.buffer).setUint32(4, body.length, true);
      b.set(body, 8);
      return b;
    };
    const fmt = new DataView(new ArrayBuffer(16));
    [3, 1].forEach((v, i) => fmt.setUint16(i * 2, v, true));
    fmt.setUint32(4, RATE, true);
    fmt.setUint32(8, RATE * 4, true);
    fmt.setUint16(12, 4, true);
    fmt.setUint16(14, 32, true);
    const parts = [chunk('fmt ', new Uint8Array(fmt.buffer)), chunk('PEAK', new Uint8Array(4)), chunk('data', new Uint8Array(samples.buffer))];
    const head = new Uint8Array(12);
    head.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0);
    head.set([...'WAVE'].map((c) => c.charCodeAt(0)), 8);
    const all = new Uint8Array(12 + parts.reduce((n, p) => n + p.length, 0));
    all.set(head, 0);
    parts.reduce((o, p) => (all.set(p, o), o + p.length), 12);
    expect([...parseWav(all.buffer)]).toEqual([0.5, -0.25, 1]);
  });
});

describe('anchorClip', () => {
  it("joins the speaker's first reference turns up to the limit, skipping everyone else's", () => {
    const pcm = Float32Array.from({ length: at(10_000) }, (_, i) => Math.floor(i / at(1000)));
    const clip = anchorClip(pcm, [[0, 1000, 'B'], [1000, 3000, 'A'], [5000, 8000, 'A']], 'A', 4000);
    expect(clip.length).toBe(at(4000));
    expect(clip[0]).toBe(1);
    expect(clip[at(2000)]).toBe(5);
    expect(clip.at(-1)).toBe(6);
  });
  it('takes nothing before `fromMs`: a turn straddling it is cut at it', () => {
    const pcm = Float32Array.from({ length: at(10_000) }, (_, i) => Math.floor(i / at(1000)));
    const clip = anchorClip(pcm, [[1000, 3000, 'A'], [5000, 8000, 'A']], 'A', 30_000, 6000);
    expect(clip.length).toBe(at(2000));
    expect(clip[0]).toBe(6);
  });
});

describe('lastSpans / clipOf', () => {
  it("takes the speaker's last reference speech up to the limit, cutting the earliest turn it reaches", () => {
    const turns: [number, number, string][] = [[0, 2000, 'A'], [2000, 3000, 'B'], [4000, 6000, 'A'], [7000, 8000, 'A']];
    expect(lastSpans(turns, 'A', 2500)).toEqual([[4500, 6000, 'A'], [7000, 8000, 'A']]);
    expect(lastSpans(turns, 'C', 2500)).toEqual([]);
  });
  it('joins the spans of a source in time order', () => {
    const pcm = Float32Array.from({ length: at(10_000) }, (_, i) => Math.floor(i / at(1000)));
    const clip = clipOf(pcm, [[4500, 6000, 'A'], [7000, 8000, 'A']]);
    expect(clip.length).toBe(at(2500));
    expect(clip[0]).toBe(4);
    expect(clip.at(-1)).toBe(7);
  });
});

describe('nameVoices', () => {
  const seg = (label: string, startMs: number, endMs: number) => ({ label, startMs, endMs, confidence: 0.9 });
  it('names each listed voice after the reference speaker its longest stretches overlap most; audience stays unnamed', () => {
    const map = nameVoices(
      [
        { label: 'S0', totalMs: 20_000, longest: [seg('S0', 0, 12_000), seg('S0', 18_000, 30_000)] },
        { label: 'S1', totalMs: 11_000, longest: [seg('S1', 40_000, 51_000)] },
      ],
      [[0, 10_000, 'A'], [10_000, 30_000, 'B'], [40_000, 52_000, 'UNK']],
      ['A', 'B'],
    );
    expect(map).toEqual({ S0: 'B', S1: null });
  });
});

describe('speechWords', () => {
  it('places ~300 ms words over speech and none over silence', () => {
    const pcm = new Float32Array(at(6000));
    for (let i = at(3000); i < at(4000); i++) pcm[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / RATE);
    for (let i = 0; i < pcm.length; i++) pcm[i] = pcm[i]! + 0.0005 * Math.sin(i);
    const words = speechWords(pcm);
    expect(words.length).toBeGreaterThanOrEqual(3);
    expect(words[0]!.startMs).toBeGreaterThanOrEqual(2900);
    expect(words.at(-1)!.endMs).toBeLessThanOrEqual(4100);
    expect(words.every((w) => w.endMs - w.startMs <= 300)).toBe(true);
  });
});

describe('linesFromEvents', () => {
  const final = (id: string, participantKey: string, confidence: number, voiceprint?: Record<string, number>) => ({ type: 'utterance.final', payload: { utterance: { id, participantKey, startMs: 0, endMs: 500, attribution: { confidence, signals: voiceprint ? { voiceprint } : {} } } } });
  it('reads each final line with its confidence, held with its best candidate when an attribution.pending came with it', () => {
    const events = [
      { type: 'attribution.pending', payload: { utteranceId: 'u1', candidates: { A: 0.6, B: 0.3 } } },
      final('u1', 'UNK', 0.6),
      final('u2', 'B', 0.93),
    ] as unknown as DomainEvent[];
    expect(linesFromEvents(events)).toEqual([
      { startMs: 0, endMs: 500, participantKey: 'UNK', confidence: 0.6, pending: true, candidate: 'A' },
      { startMs: 0, endMs: 500, participantKey: 'B', confidence: 0.93, pending: false },
    ]);
  });
  it('flags a line the voice-only cap bound, from the decision the runner reported, and keeps its channel', () => {
    const events = [
      { type: 'attribution.pending', payload: { utteranceId: 'u1', candidates: { A: 0.84 } } },
      { type: 'utterance.final', payload: { utterance: { id: 'u1', participantKey: 'UNK', startMs: 0, endMs: 500, attribution: { confidence: 0.84, signals: { channel: 'd0c0', voiceprint: { A: 0.97 } } } } } },
      final('u2', 'B', 0.84),
    ] as unknown as DomainEvent[];
    const [capped, plain] = linesFromEvents(events, new Map([['u1', { uncapped: 0.97 }], ['u2', {}]]));
    expect(capped).toMatchObject({ candidate: 'A', confidence: 0.84, capped: true, uncapped: 0.97, channel: 'd0c0' });
    expect(plain!.capped).toBeUndefined();
    expect(plain!.uncapped).toBeUndefined();
  });
});
