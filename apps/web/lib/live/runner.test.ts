import { describe, expect, it } from 'vitest';
import type { DomainEvent } from '@adl/core';
import { LiveRunner } from './runner';

class Mem { kind = 'http' as const; where = 'mem'; events: DomainEvent[] = []; async append(e: DomainEvent[]) { this.events.push(...e); } async read(c: number) { return { cursor: this.events.length, events: this.events.slice(c) }; } async logCall() {} }
const pcm = new Float32Array(16_000);
const asr = { transcribe: async (_p: Float32Array, off: number) => [{ text: 'Hello', startMs: off, endMs: off + 400 }] };
type Final = Extract<DomainEvent, { type: 'utterance.final' }>;

describe('LiveRunner', () => {
  it('emits pending before final for an unsure voice, and a confirm releases it', async () => {
    const log = new Mem();
    const r = new LiveRunner({
      sessionId: 's', setup: { kind: 'room', channels: {}, participants: [{ key: 'A', displayName: 'Ann' }] }, anchors: [],
      asr: { transcribe: async (_p, off) => [{ text: 'Hello', startMs: off, endMs: off + 400 }] },
      voices: { matchVoices: async () => ({ A: 0.3 }) }, log, onStatus: () => {},
    });
    await r.onUtterance('mono', { startMs: 1000, endMs: 2000, pcm }, {}, false);
    expect(log.events.map((e) => e.type)).toEqual(['attribution.pending', 'utterance.final']);
    const id = (log.events[1] as Final).payload.utterance.id;
    await r.confirm(id, 'A');
    expect(log.events.at(-1)).toMatchObject({ type: 'attribution.confirmed', actor: 'operator', payload: { utteranceId: id, participantKey: 'A' } });
  });
  it('drops a bleed copy and skips voice matching on an unambiguous channel', async () => {
    const log = new Mem();
    let matched = 0;
    const r = new LiveRunner({
      sessionId: 's', setup: { kind: 'tracks', channels: { L: 'A', R: 'B' }, participants: [] }, anchors: [],
      asr: { transcribe: async (_p, off) => [{ text: 'x', startMs: off, endMs: off + 300 }] },
      voices: { matchVoices: async () => { matched++; return {}; } }, log, onStatus: () => {},
    });
    await r.onUtterance('L', { startMs: 0, endMs: 1000, pcm }, { L: -18, R: -40 }, false);
    await r.onUtterance('R', { startMs: 0, endMs: 1000, pcm }, { L: -18, R: -32 }, false);
    expect(log.events.filter((e) => e.type === 'utterance.final')).toHaveLength(1);
    expect(matched).toBe(0);
  });
  it('holds a candidate as UNK with its confidence, then confirms and clears it from status', async () => {
    const log = new Mem();
    const statuses: import('./runner').LiveStatus[] = [];
    const r = new LiveRunner({
      sessionId: 's', setup: { kind: 'room', channels: {}, participants: [] }, anchors: [],
      asr, voices: { matchVoices: async () => ({ A: 0.6 }) }, log, onStatus: (s) => statuses.push(s), now: () => 5_000,
    });
    await r.onUtterance('mono', { startMs: 0, endMs: 900, pcm }, {}, false);
    const [pending, fin] = log.events as [Extract<DomainEvent, { type: 'attribution.pending' }>, Final];
    expect(fin.payload.utterance.participantKey).toBe('UNK');
    expect(fin.payload.utterance.attribution).toMatchObject({ confirmedBy: 'auto' });
    expect(pending.payload.candidates).toEqual({ A: fin.payload.utterance.attribution.confidence });
    expect(fin.payload.utterance.id).toBe('umono-0');
    expect(fin.wallTs).toBe(new Date(5_000).toISOString());
    expect(statuses.at(-1)!.unconfirmed).toHaveLength(1);
    expect(statuses.at(-1)!.lastLatencyMs).toBe(0);
    await r.confirm('umono-0', 'A');
    expect(statuses.at(-1)!.unconfirmed).toHaveLength(0);
  });
  it('labels unmatched voices Voice N and lists their utterances', async () => {
    const log = new Mem();
    const statuses: import('./runner').LiveStatus[] = [];
    const r = new LiveRunner({
      sessionId: 's', setup: { kind: 'room', channels: {}, participants: [] }, anchors: [],
      asr, voices: { matchVoices: async () => ({}) }, log, onStatus: (s) => statuses.push(s),
    });
    await r.onUtterance('mono', { startMs: 0, endMs: 900, pcm }, {}, false);
    await r.onUtterance('mono', { startMs: 5000, endMs: 5900, pcm }, {}, false);
    expect(statuses.at(-1)!.newVoices).toEqual([{ label: 'Voice 1', utteranceIds: ['umono-0'] }, { label: 'Voice 2', utteranceIds: ['umono-5000'] }]);
  });
  it('skips empty transcriptions and keeps going after a failure', async () => {
    const log = new Mem();
    let n = 0;
    const r = new LiveRunner({
      sessionId: 's', setup: { kind: 'room', channels: {}, participants: [] }, anchors: [],
      asr: { transcribe: async (_p, off) => { n++; if (n === 1) return []; if (n === 2) throw new Error('boom'); return [{ text: 'ok', startMs: off, endMs: off + 200 }]; } },
      voices: { matchVoices: async () => ({ A: 0.99 }) }, log, onStatus: () => {},
    });
    await r.onUtterance('mono', { startMs: 0, endMs: 900, pcm }, {}, false);
    await expect(r.onUtterance('mono', { startMs: 1000, endMs: 1900, pcm }, {}, false)).rejects.toThrow('boom');
    await r.onUtterance('mono', { startMs: 2000, endMs: 2900, pcm }, {}, false);
    expect(log.events.map((e) => e.type)).toEqual(['utterance.final']);
    expect((log.events[0] as Final).payload.utterance.participantKey).toBe('A');
  });
});
