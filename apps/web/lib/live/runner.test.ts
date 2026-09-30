import { singleVoice } from './test-voices';
import { describe, expect, it } from 'vitest';
import type { DomainEvent } from '@adl/core';
import { LiveRunner } from './runner';

class Mem { kind = 'http' as const; where = 'mem'; events: DomainEvent[] = []; async append(e: DomainEvent[]) { this.events.push(...e); } async read(c: number) { return { cursor: this.events.length, events: this.events.slice(c) }; } async logCall() {} }
const pcm = new Float32Array(16_000);
const asr = { transcribe: async (_p: Float32Array, off: number) => [{ text: 'Hello', startMs: off, endMs: off + 400 }] };
type Final = Extract<DomainEvent, { type: 'utterance.final' }>;
const finals = (log: Mem) => log.events.filter((e): e is Final => e.type === 'utterance.final');

describe('LiveRunner', () => {
  it('emits pending before final for an unsure voice, and a confirm releases it', async () => {
    const log = new Mem();
    const r = new LiveRunner({
      sessionId: 's', setup: { kind: 'room', channels: {}, participants: [{ key: 'A', displayName: 'Ann' }] }, anchors: [],
      asr: { transcribe: async (_p, off) => [{ text: 'Hello', startMs: off, endMs: off + 400 }] },
      voices: singleVoice({ matchVoices: async () => ({ A: 0.3 }) }), log, onStatus: () => {},
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
      voices: singleVoice({ matchVoices: async () => { matched++; return {}; } }), log, onStatus: () => {},
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
      asr, voices: singleVoice({ matchVoices: async () => ({ A: 0.6 }) }), log, onStatus: (s) => statuses.push(s), now: () => 5_000,
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
      asr, voices: singleVoice({ matchVoices: async () => ({}) }), log, onStatus: (s) => statuses.push(s),
    });
    await r.onUtterance('mono', { startMs: 0, endMs: 900, pcm }, {}, false);
    await r.onUtterance('mono', { startMs: 5000, endMs: 5900, pcm }, {}, false);
    expect(statuses.at(-1)!.newVoices).toEqual([{ label: 'Voice 1', utteranceIds: ['umono-0'] }, { label: 'Voice 2', utteranceIds: ['umono-5000'] }]);
  });
  it('skips empty transcriptions', async () => {
    const log = new Mem();
    const r = new LiveRunner({
      sessionId: 's', setup: { kind: 'room', channels: {}, participants: [] }, anchors: [],
      asr: { transcribe: async () => [] }, voices: singleVoice({ matchVoices: async () => ({ A: 0.99 }) }), log, onStatus: () => {},
    });
    await r.onUtterance('mono', { startMs: 0, endMs: 900, pcm }, {}, false);
    expect(log.events).toEqual([]);
  });
  it('reports a failed transcription in status and retries it with the kept audio', async () => {
    const log = new Mem();
    let broken = true;
    const statuses: import('./runner').LiveStatus[] = [];
    const r = new LiveRunner({
      sessionId: 's', setup: { kind: 'room', channels: {}, participants: [] }, anchors: [],
      asr: { transcribe: async (_p, off) => { if (broken) throw new Error('boom'); return [{ text: 'ok', startMs: off, endMs: off + 200 }]; } },
      voices: singleVoice({ matchVoices: async () => ({ A: 0.99 }) }), log, onStatus: (s) => statuses.push(s), gates: {},
    });
    await r.onUtterance('mono', { startMs: 1000, endMs: 1900, pcm }, {}, false);
    expect(statuses.at(-1)!.failed).toEqual([{ channel: 'mono', startMs: 1000, endMs: 1900, reason: 'boom' }]);
    expect(log.events).toEqual([]);
    broken = false;
    await r.retry(0);
    expect(statuses.at(-1)!.failed).toEqual([]);
    // One mic, voice only: held for the host until the gate is measured (P2-R9).
    expect(finals(log)[0]!.payload.utterance.participantKey).toBe('UNK');
    expect(log.events[0]).toMatchObject({ type: 'attribution.pending', payload: { candidates: { A: 0.84 } } });
  });
  it('reports a failed append and keeps the audio', async () => {
    const log = new Mem();
    let bad = true;
    const append = log.append.bind(log);
    log.append = async (e) => { if (bad) throw new Error('offline'); return append(e); };
    const statuses: import('./runner').LiveStatus[] = [];
    const r = new LiveRunner({ sessionId: 's', setup: { kind: 'room', channels: {}, participants: [] }, anchors: [], asr, voices: singleVoice({ matchVoices: async () => ({ A: 0.99 }) }), log, onStatus: (s) => statuses.push(s), gates: {} });
    await r.onUtterance('mono', { startMs: 0, endMs: 900, pcm }, {}, false);
    expect(statuses.at(-1)!.failed[0]!.reason).toBe('offline');
    bad = false;
    await r.retry(0);
    expect(log.events.map((e) => e.type)).toEqual(['attribution.pending', 'utterance.final']);
  });
  it('keeps the transcript when voice matching fails, and warns once per streak', async () => {
    const log = new Mem();
    let fail = true;
    const statuses: import('./runner').LiveStatus[] = [];
    const r = new LiveRunner({
      sessionId: 's', setup: { kind: 'room', channels: {}, participants: [] }, anchors: [], asr,
      voices: singleVoice({ matchVoices: async () => { if (fail) throw new Error('model gone'); return { A: 0.99 }; } }), log, onStatus: (s) => statuses.push(s),
    });
    await r.onUtterance('mono', { startMs: 0, endMs: 900, pcm }, {}, false);
    await r.onUtterance('mono', { startMs: 2000, endMs: 2900, pcm }, {}, false);
    expect(log.events.map((e) => e.type)).toEqual(['attribution.pending', 'utterance.final', 'attribution.pending', 'utterance.final']);
    expect((log.events[1] as Final).payload.utterance.participantKey).toBe('UNK');
    expect(statuses.at(-1)!.notices.filter((n) => n.kind === 'voice_match_unavailable')).toHaveLength(1);
    expect(statuses.at(-1)!.newVoices).toEqual([]);
    fail = false;
    await r.onUtterance('mono', { startMs: 4000, endMs: 4900, pcm }, {}, false);
    fail = true;
    await r.onUtterance('mono', { startMs: 6000, endMs: 6900, pcm }, {}, false);
    expect(statuses.at(-1)!.notices.filter((n) => n.kind === 'voice_match_unavailable')).toHaveLength(2);
  });
  it('groups unmatched utterances by a temporary voice anchor', async () => {
    const log = new Mem();
    const statuses: import('./runner').LiveStatus[] = [];
    const seen: string[][] = [];
    const r = new LiveRunner({
      sessionId: 's', setup: { kind: 'room', channels: {}, participants: [] }, anchors: [{ key: 'A', pcm }], asr,
      voices: singleVoice({ matchVoices: async (anchors) => { seen.push(anchors.map((a) => a.key)); const out: Record<string, number> = { A: 0.1 }; if (anchors.some((a) => a.key === 'Voice 1')) out['Voice 1'] = 0.8; return out; } }),
      log, onStatus: (s) => statuses.push(s),
    });
    await r.onUtterance('mono', { startMs: 0, endMs: 900, pcm }, {}, false);
    await r.onUtterance('mono', { startMs: 5000, endMs: 5900, pcm }, {}, false);
    // The main match sees enrolled voices only; Voice 1 is matched in a second pass of its own.
    expect(seen).toEqual([['A'], ['A'], ['Voice 1']]);
    expect(statuses.at(-1)!.newVoices).toEqual([{ label: 'Voice 1', utteranceIds: ['umono-0', 'umono-5000'] }]);
    // Temporary voices never reach the attributor as participants.
    expect((log.events.at(-1) as Final).payload.utterance.participantKey).toBe('UNK');
  });
  it('caps temporary voices at two', async () => {
    const log = new Mem();
    const statuses: import('./runner').LiveStatus[] = [];
    const r = new LiveRunner({ sessionId: 's', setup: { kind: 'room', channels: {}, participants: [] }, anchors: [], asr, voices: singleVoice({ matchVoices: async () => ({}) }), log, onStatus: (s) => statuses.push(s) });
    for (let i = 0; i < 6; i++) await r.onUtterance('mono', { startMs: i * 5000, endMs: i * 5000 + 900, pcm }, {}, false);
    expect(statuses.at(-1)!.newVoices.map((v) => v.label)).toEqual(['Voice 1', 'Voice 2']);
    expect(statuses.at(-1)!.unconfirmed).toHaveLength(6);
  });
  it('measures latency from the caller wall time when given', async () => {
    const statuses: import('./runner').LiveStatus[] = [];
    const r = new LiveRunner({ sessionId: 's', setup: { kind: 'room', channels: {}, participants: [] }, anchors: [], asr, voices: singleVoice({ matchVoices: async () => ({ A: 0.99 }) }), log: new Mem(), onStatus: (s) => statuses.push(s), now: () => 10_000 });
    await r.onUtterance('mono', { startMs: 0, endMs: 900, pcm }, {}, false, 7_500);
    expect(statuses.at(-1)!.lastLatencyMs).toBe(2_500);
  });
  it('does not drop a correction back to an earlier choice, and ignores audio after stop', async () => {
    const log = new Mem();
    const r = new LiveRunner({ sessionId: 's', setup: { kind: 'room', channels: {}, participants: [] }, anchors: [], asr, voices: singleVoice({ matchVoices: async () => ({ A: 0.6 }) }), log, onStatus: () => {} });
    await r.onUtterance('mono', { startMs: 0, endMs: 900, pcm }, {}, false);
    await r.confirm('umono-0', 'A');
    await r.confirm('umono-0', 'B');
    await r.confirm('umono-0', 'A');
    const ids = log.events.filter((e) => e.type === 'attribution.confirmed').map((e) => e.eventId);
    expect(new Set(ids).size).toBe(3);
    await r.stop();
    const n = log.events.length;
    await r.onUtterance('mono', { startMs: 9000, endMs: 9900, pcm }, {}, false);
    expect(log.events.length).toBe(n);
  });
  it('keeps confirm ids unique across reloads (a new runner reuses no id)', async () => {
    const log = new Mem();
    const make = (t: number) => new LiveRunner({ sessionId: 's', setup: { kind: 'room', channels: {}, participants: [] }, anchors: [], asr, voices: singleVoice({ matchVoices: async () => ({}) }), log, onStatus: () => {}, now: () => t });
    await make(1_000).confirm('umono-0', 'A');
    await make(2_000).confirm('umono-0', 'A');
    const ids = log.events.map((e) => e.eventId);
    expect(ids).toEqual(['s:umono-0:confirmed:1000-1', 's:umono-0:confirmed:2000-1']);
  });
  it('retries a failed utterance by channel and start, whatever its position', async () => {
    const log = new Mem();
    let broken = true;
    const statuses: import('./runner').LiveStatus[] = [];
    const r = new LiveRunner({
      sessionId: 's', setup: { kind: 'room', channels: {}, participants: [] }, anchors: [],
      asr: { transcribe: async (_p, off) => { if (broken) throw new Error('boom'); return [{ text: 'ok', startMs: off, endMs: off + 200 }]; } },
      voices: singleVoice({ matchVoices: async () => ({ A: 0.99 }) }), log, onStatus: (s) => statuses.push(s), gates: {},
    });
    await r.onUtterance('mono', { startMs: 1000, endMs: 1900, pcm }, {}, false);
    await r.onUtterance('mono', { startMs: 3000, endMs: 3900, pcm }, {}, false);
    broken = false;
    await r.retryAt('mono', 3000);
    expect(statuses.at(-1)!.failed.map((f) => f.startMs)).toEqual([1000]);
    expect(finals(log)[0]!.payload.utterance.id).toBe('umono-3000');
    await r.retryAt('mono', 9999);
    expect(statuses.at(-1)!.failed).toHaveLength(1);
  });
  it('keeps the last three latencies, one per utterance', async () => {
    const statuses: import('./runner').LiveStatus[] = [];
    const t = 10_000;
    const r = new LiveRunner({ sessionId: 's', setup: { kind: 'room', channels: {}, participants: [] }, anchors: [], asr, voices: singleVoice({ matchVoices: async () => ({ A: 0.99 }) }), log: new Mem(), onStatus: (s) => statuses.push(s), now: () => t });
    for (const [i, lag] of [1000, 5000, 6000, 7000].entries()) await r.onUtterance('mono', { startMs: i * 2000, endMs: i * 2000 + 900, pcm }, {}, false, t - lag);
    expect(statuses.at(-1)!.recentLatencyMs).toEqual([5000, 6000, 7000]);
  });
});

it('holds clear-channel speech when a required voice check fails, including an unavailable model', async () => {
  for (const unavailable of [false, true]) {
    const log = new Mem();
    const r = new LiveRunner({
      sessionId: 's', setup: { kind: 'tracks', channels: { L: 'A', R: 'B' }, participants: [{ key: 'A', displayName: 'Ann' }, { key: 'B', displayName: 'Bo' }] },
      anchors: unavailable ? [{ key: 'A', pcm }, { key: 'B', pcm }] : [],
      voicesAvailable: !unavailable,
      asr, voices: singleVoice({ matchVoices: async () => { throw new Error('worker stopped'); } }), log, onStatus: () => {},
    });
    await r.onUtterance('L', { startMs: 0, endMs: 1000, pcm }, { L: -18, R: -40 }, false);
    await r.stop();
    expect(log.events[0]).toMatchObject({ type: 'attribution.pending' });
    expect(finals(log)[0]!.payload.utterance.participantKey).toBe('UNK');
  }
});
