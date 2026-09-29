import { describe, expect, it } from 'vitest';
import { buildUtterances, splitIntoUtterances } from './utterances';

const w = (text: string, startMs: number) => ({ text, startMs, endMs: startMs + 300 });
const words = [w('Taxes', 0), w('should', 400), w('fall.', 800), w('No,', 5_000), w('rise.', 5_400), w('Question', 9_000)];
const segments = [
  { startMs: 0, endMs: 1_200, label: 'S0', confidence: 0.9 },
  { startMs: 4_900, endMs: 5_800, label: 'S1', confidence: 0.92 },
  { startMs: 8_900, endMs: 9_400, label: 'S2', confidence: 0.8 },
];

describe('splitIntoUtterances', () => {
  it('splits at pauses of 800 ms or more', () => expect(splitIntoUtterances(words).map((u) => u.length)).toEqual([3, 2, 1]));
});

describe('buildUtterances', () => {
  const evs = buildUtterances({ sessionId: 's', words, segments, voiceMap: { S0: 'A', S1: 'B', S2: null }, mode: 'diarized', wallTs: new Date(0).toISOString() });
  const finals = evs.filter((e) => e.type === 'utterance.final').map((e) => (e.type === 'utterance.final' ? e.payload.utterance : null)!);
  it('attributes named voices with the diarizer label as the signal', () => {
    expect(finals[0]).toMatchObject({ participantKey: 'A', text: 'Taxes should fall.', attribution: { confirmedBy: 'operator', signals: { diarLabel: 'S0' } } });
    expect(finals[1]!.participantKey).toBe('B');
  });
  it('holds an unnamed voice as UNK with attribution.pending, never as a debater', () => {
    expect(finals[2]).toMatchObject({ participantKey: 'UNK' });
    expect(finals[2]!.attribution.confidence).toBeLessThan(0.85);
    expect(evs.some((e) => e.type === 'attribution.pending' && e.payload.utteranceId === finals[2]!.id)).toBe(true);
  });
  it('emits attribution.pending before its utterance.final', () => {
    const id = finals[2]!.id;
    const pendingAt = evs.findIndex((e) => e.type === 'attribution.pending' && e.payload.utteranceId === id);
    const finalAt = evs.findIndex((e) => e.type === 'utterance.final' && e.payload.utterance.id === id);
    expect(pendingAt).toBeGreaterThanOrEqual(0);
    expect(pendingAt).toBeLessThan(finalAt);
  });
  it('is deterministic: same input, same event ids', () => {
    const again = buildUtterances({ sessionId: 's', words, segments, voiceMap: { S0: 'A', S1: 'B', S2: null }, mode: 'diarized', wallTs: new Date(0).toISOString() });
    expect(again.map((e) => e.eventId)).toEqual(evs.map((e) => e.eventId));
  });
});

const finalsOf = (evs: ReturnType<typeof buildUtterances>) => evs.flatMap((e) => (e.type === 'utterance.final' ? [e.payload.utterance] : []));
const base = { sessionId: 's', mode: 'diarized' as const, wallTs: new Date(0).toISOString() };

describe('buildUtterances on real diarizer output', () => {
  it('does not throw when a word midpoint falls in a gap between same-label segments', () => {
    const segs = [
      { startMs: 0, endMs: 400, label: 'S0', confidence: 0.9 },
      { startMs: 800, endMs: 1_300, label: 'S0', confidence: 0.7 },
    ];
    const evs = buildUtterances({ ...base, words: [w('Hello', 0), w('again', 900)], segments: segs, voiceMap: { S0: 'A' } });
    const [u] = finalsOf(evs);
    expect(u).toBeDefined();
    expect(u!.participantKey === 'A' || u!.participantKey === 'UNK').toBe(true);
    if (u!.participantKey === 'A') expect(u!.attribution.confidence).toBeLessThanOrEqual(0.7);
  });

  it('never commits an utterance with another voice speaking inside it', () => {
    const segs = [
      { startMs: 0, endMs: 10_000, label: 'S0', confidence: 0.9 },
      { startMs: 4_000, endMs: 6_000, label: 'S1', confidence: 0.9 },
    ];
    const ws = Array.from({ length: 20 }, (_, i) => ({ text: `w${i}`, startMs: i * 450, endMs: i * 450 + 450 }));
    const evs = buildUtterances({ ...base, words: ws, segments: segs, voiceMap: { S0: 'A', S1: 'B' } });
    const fs = finalsOf(evs);
    expect(fs.length).toBeGreaterThan(1);
    for (const u of fs) {
      expect(u.attribution.confidence).toBeLessThan(0.85);
      expect(evs.some((e) => e.type === 'attribution.pending' && e.payload.utteranceId === u.id)).toBe(true);
    }
  });

  it('treats a word inside overlapping segments as unattributed', () => {
    const segs = [
      { startMs: 0, endMs: 3_000, label: 'S0', confidence: 0.9 },
      { startMs: 1_000, endMs: 3_000, label: 'S1', confidence: 0.9 },
    ];
    const evs = buildUtterances({ ...base, words: [w('both', 1_500)], segments: segs, voiceMap: { S0: 'A', S1: 'B' } });
    expect(finalsOf(evs)[0]).toMatchObject({ participantKey: 'UNK' });
    expect(finalsOf(evs)[0]!.attribution.confidence).toBeLessThan(0.85);
  });

  it('holds speech outside any segment as UNK with attribution.pending', () => {
    const evs = buildUtterances({ ...base, words: [w('stray', 20_000)], segments, voiceMap: { S0: 'A' } });
    const u = finalsOf(evs)[0]!;
    expect(u.participantKey).toBe('UNK');
    expect(evs.some((e) => e.type === 'attribution.pending' && e.payload.utteranceId === u.id)).toBe(true);
  });
});

describe('track mode', () => {
  it('attributes to the track owner at confidence 1 with the channel signal and owner-scoped ids', () => {
    const a = buildUtterances({ ...base, mode: 'tracks', trackOwner: 'A', words: [w('One', 0)], segments: [], voiceMap: {} });
    const b = buildUtterances({ ...base, mode: 'tracks', trackOwner: 'B', words: [w('Two', 0)], segments: [], voiceMap: {} });
    expect(finalsOf(a)[0]).toMatchObject({ participantKey: 'A', id: 'uA-0', attribution: { confidence: 1, signals: { channel: 'A' } } });
    expect(a.some((e) => e.type === 'attribution.pending')).toBe(false);
    expect(finalsOf(b)[0]!.id).toBe('uB-0');
    expect(a[0]!.eventId).not.toBe(b[0]!.eventId);
  });
});
