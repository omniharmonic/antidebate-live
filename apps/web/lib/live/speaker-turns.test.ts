import { expect, it } from 'vitest';
import { splitSpeakerTurns } from './speaker-turns';
import { LiveRunner } from './runner';
import { MemoryEventLog } from './memory-log';

const turns = [
  { startMs: 0, endMs: 2000, label: 's0', voice: { A: 1, B: 0 } },
  { startMs: 2000, endMs: 4000, label: 's1', voice: { A: 0, B: 1 } },
];
const words = [{ text: 'Yes.', startMs: 500, endMs: 1000 }, { text: 'No.', startMs: 2500, endMs: 3000 }];
it('splits a continuous mixed-feed exchange at diarized speaker changes without dropping words', () => {
  const split = splitSpeakerTurns(words, turns, 0);
  expect(split.map((p) => p.voice)).toEqual([{ A: 1, B: 0 }, { A: 0, B: 1 }]);
  expect(split.flatMap((p) => p.words)).toEqual(words);
});
it('holds boundary, overlapping and uncovered words instead of guessing', () => {
  const words = [{ text: 'boundary', startMs: 1900, endMs: 2100 }, { text: 'gap', startMs: 4500, endMs: 4700 }];
  expect(splitSpeakerTurns(words, turns, 0).every((p) => p.uncertain)).toBe(true);
  const overlap = [...turns, { ...turns[0]!, startMs: 2500, endMs: 3000 }];
  expect(splitSpeakerTurns([{ text: 'overlap', startMs: 2600, endMs: 2800 }], overlap, 0)[0]).toMatchObject({ voice: {}, uncertain: true });
});
for (const kind of ['room', 'call'] as const) it(`${kind}: one audio cut produces separate reviewable lines and replay clips for two speakers`, async () => {
  const log = new MemoryEventLog();
  const clips: string[] = [];
  const runner = new LiveRunner({
    sessionId: 'qa', setup: { kind, channels: {}, participants: [{ key: 'A', displayName: 'Ann' }, { key: 'B', displayName: 'Bo' }] },
    anchors: [], asr: { transcribe: async () => words },
    voices: { matchTurns: async () => turns, matchVoices: async () => ({}) },
    log, onStatus: () => {}, gates: {},
  });
  await runner.onUtterance('mono', { startMs: 0, endMs: 4000, pcm: new Float32Array(64000) }, {}, false, undefined, (id) => clips.push(id));
  await runner.stop();
  const lines = log.events.flatMap((e) => e.type === 'utterance.final' ? [e.payload.utterance] : []);
  expect(lines.map((u) => u.text)).toEqual(['Yes.', 'No.']);
  expect(lines.map((u) => u.participantKey)).toEqual(['UNK', 'UNK']);
  expect(log.events.flatMap((e) => e.type === 'attribution.pending' ? [Object.keys(e.payload.candidates)] : [])).toEqual([['A'], ['B']]);
  expect(clips).toEqual(lines.map((u) => u.id));
  await runner.confirm(lines[0]!.id, 'A');
  expect(log.events.at(-1)).toMatchObject({ type: 'attribution.confirmed', payload: { participantKey: 'A', utteranceId: lines[0]!.id } });
});
