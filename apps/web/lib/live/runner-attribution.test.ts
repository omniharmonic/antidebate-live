import { describe, expect, it } from 'vitest';
import type { DomainEvent } from '@adl/core';
import type { Anchor } from '../attribution/anchors';
import { LiveRunner, type LiveStatus } from './runner';

class Mem { kind = 'http' as const; where = 'mem'; events: DomainEvent[] = []; async append(e: DomainEvent[]) { this.events.push(...e); } async read(c: number) { return { cursor: this.events.length, events: this.events.slice(c) }; } async logCall() {} }
type Final = Extract<DomainEvent, { type: 'utterance.final' }>;
type Pending = Extract<DomainEvent, { type: 'attribution.pending' }>;
const finals = (log: Mem) => log.events.filter((e): e is Final => e.type === 'utterance.final');
const pendings = (log: Mem) => log.events.filter((e): e is Pending => e.type === 'attribution.pending');
const pcm = new Float32Array(16_000);
const anchor = (key: string): Anchor => ({ key, pcm });
const people = (...keys: string[]) => keys.map((key) => ({ key, displayName: key }));
const words = { transcribe: async (_p: Float32Array, off: number) => [{ text: 'Words', startMs: off, endMs: off + 400 }] };
const clean = { L: -20, R: -34 }; // 14 dB margin for L

function tracks(o: { participants: string[]; anchors: string[]; match: (a: Anchor[]) => Record<string, number>; log?: Mem; statuses?: LiveStatus[]; asr?: typeof words }) {
  const calls: string[][] = [];
  const log = o.log ?? new Mem();
  const r = new LiveRunner({
    sessionId: 's', setup: { kind: 'tracks', channels: { L: 'A', R: 'B' }, participants: people(...o.participants) }, anchors: o.anchors.map(anchor),
    asr: o.asr ?? words, voices: { matchVoices: async (a) => { calls.push(a.map((x) => x.key)); return o.match(a); } }, log, onStatus: (s) => o.statuses?.push(s),
  });
  return { r, log, calls };
}

describe('LiveRunner attribution (final fixes)', () => {
  it('C1: an unmiked moderator on debater A\'s mic at a 14 dB margin is matched and held, not given to A', async () => {
    const { r, log, calls } = tracks({ participants: ['A', 'B', 'M'], anchors: ['A', 'B', 'M'], match: () => ({ A: 0.05, B: 0, M: 0.9 }) });
    await r.onUtterance('L', { startMs: 0, endMs: 1000, pcm }, clean, false);
    expect(calls).toHaveLength(1);
    expect(finals(log)[0]!.payload.utterance.participantKey).toBe('UNK');
    expect(Object.keys(pendings(log)[0]!.payload.candidates).sort()).toEqual(['A', 'M']);
  });

  it('C1: everyone miked and enrolled, a clean margin auto-accepts without a voice match', async () => {
    const { r, log, calls } = tracks({ participants: ['A', 'B'], anchors: ['A', 'B'], match: () => ({ A: 0.9 }) });
    await r.onUtterance('L', { startMs: 0, endMs: 1000, pcm }, clean, false);
    expect(calls).toHaveLength(0);
    expect(pendings(log)).toHaveLength(0);
    expect(finals(log)[0]!.payload.utterance.participantKey).toBe('A');
  });

  it('C1: someone skipped enrollment, so clean margins are still voice-matched', async () => {
    const { r, log, calls } = tracks({ participants: ['A', 'B'], anchors: ['A'], match: () => ({ A: 0.9 }) });
    await r.onUtterance('L', { startMs: 0, endMs: 1000, pcm }, clean, false);
    expect(calls).toHaveLength(1);
    expect(finals(log)[0]!.payload.utterance.participantKey).toBe('A');
  });

  it('1: a swapped mic pair raises swap_suggested within five sampled mismatches', async () => {
    const statuses: LiveStatus[] = [];
    const { r, calls } = tracks({ participants: ['A', 'B'], anchors: ['A', 'B'], match: () => ({ A: 0.05, B: 0.9 }), statuses });
    for (let i = 0; i < 20; i++) await r.onUtterance('L', { startMs: i * 2000, endMs: i * 2000 + 1000, pcm }, clean, false);
    await r.stop();
    expect(calls).toHaveLength(5);
    expect(statuses.at(-1)!.notices).toContainEqual({ kind: 'swap_suggested', channel: 'L', participantKey: 'B' });
  });

  it('2: a clear bleed copy (6 dB or more below) is never transcribed', async () => {
    let transcribed = 0;
    const asr = { transcribe: async (p: Float32Array, off: number) => { transcribed++; return words.transcribe(p, off); } };
    const { r, log } = tracks({ participants: ['A', 'B'], anchors: ['A', 'B'], match: () => ({ B: 0.9 }), asr });
    await r.onUtterance('R', { startMs: 0, endMs: 1000, pcm }, { L: -18, R: -26 }, false);
    await r.stop();
    expect(transcribed).toBe(0);
    expect(log.events).toEqual([]);
  });

  for (const order of ['louder first', 'quieter first'] as const) {
    it(`2: the same speech on both mics within 6 dB is one line, the louder channel's (${order})`, async () => {
      const { r, log } = tracks({ participants: ['A', 'B'], anchors: ['A', 'B'], match: () => ({ A: 0.9, B: 0.05 }) });
      const loud = () => r.onUtterance('L', { startMs: 0, endMs: 2000, pcm }, { L: -20, R: -23 }, false);
      const quiet = () => r.onUtterance('R', { startMs: 100, endMs: 1900, pcm }, { L: -20, R: -23 }, false);
      if (order === 'louder first') { await loud(); await quiet(); } else { const q = quiet(); await loud(); await q; }
      await r.stop();
      expect(finals(log).map((e) => e.payload.utterance.id)).toEqual(['uL-0']);
    });
  }

  it('3: a Voice N clip resembling a debater does not zero that debater\'s score', async () => {
    const log = new Mem();
    const statuses: LiveStatus[] = [];
    let n = 0;
    // Like the real matcher: two anchors in one cluster both score 0.
    const match = async (a: Anchor[]): Promise<Record<string, number>> => (a.some((x) => x.key === 'A') && a.some((x) => x.key.startsWith('Voice')) ? { A: 0, 'Voice 1': 0 } : a.some((x) => x.key === 'A') ? { A: n++ === 0 ? 0.1 : 0.9 } : { 'Voice 1': 0.2 });
    const r = new LiveRunner({ sessionId: 's', setup: { kind: 'room', channels: {}, participants: people('A') }, anchors: [anchor('A')], asr: words, voices: { matchVoices: match }, log, onStatus: (s) => statuses.push(s) });
    await r.onUtterance('d0c0', { startMs: 0, endMs: 1000, pcm }, {}, false);
    await r.onUtterance('d0c0', { startMs: 3000, endMs: 4000, pcm }, {}, false);
    expect(pendings(log)[1]!.payload.candidates).toEqual({ A: 0.84 });
    expect(statuses.at(-1)!.newVoices).toEqual([{ label: 'Voice 1', utteranceIds: ['ud0c0-0'] }]);
  });

  it('5: dismissing a line takes it off the list with no event; it stays held', async () => {
    const statuses: LiveStatus[] = [];
    const log = new Mem();
    const r = new LiveRunner({ sessionId: 's', setup: { kind: 'room', channels: {}, participants: people('A') }, anchors: [], asr: words, voices: { matchVoices: async () => ({}) }, log, onStatus: (s) => statuses.push(s) });
    await r.onUtterance('d0c0', { startMs: 0, endMs: 1000, pcm }, {}, false);
    const before = log.events.length;
    r.dismiss(['ud0c0-0']);
    expect(log.events.length).toBe(before);
    expect(statuses.at(-1)!.unconfirmed).toEqual([]);
    expect(statuses.at(-1)!.newVoices).toEqual([]);
  });

  it('a confirmation after a reload takes its media time from the logged line', async () => {
    const log = new Mem();
    const first = new LiveRunner({ sessionId: 's', setup: { kind: 'room', channels: {}, participants: people('A') }, anchors: [], asr: words, voices: { matchVoices: async () => ({}) }, log, onStatus: () => {} });
    await first.onUtterance('d0c0', { startMs: 5000, endMs: 7000, pcm }, {}, false);
    const reloaded = new LiveRunner({ sessionId: 's', setup: { kind: 'room', channels: {}, participants: people('A') }, anchors: [], asr: words, voices: { matchVoices: async () => ({}) }, log, onStatus: () => {} });
    await reloaded.confirm('ud0c0-5000', 'A');
    expect(log.events.at(-1)).toMatchObject({ type: 'attribution.confirmed', mediaMs: 7000 });
  });
});
