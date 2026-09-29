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
