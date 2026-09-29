import { describe, expect, it } from 'vitest';
import { Attributor, type UtteranceSignals } from './attributor';

const sig = (o: Partial<UtteranceSignals>): UtteranceSignals => ({ channel: 'L', channelRmsDb: { L: -20, R: -40 }, voice: {}, overlap: false, startMs: 0, endMs: 2000, ...o });

describe('Attributor, separate tracks', () => {
  const a = () => new Attributor('tracks', { L: 'A', R: 'B' });
  it('clean own channel → owner, auto', () => {
    const { decision } = a().decide(sig({}));
    expect(decision).toMatchObject({ participantKey: 'A', pending: false });
  });
  it('bleed copy on the quieter channel is dropped, not emitted twice', () => {
    const { decision } = a().decide(sig({ channel: 'R', channelRmsDb: { L: -18, R: -30 } }));
    expect(decision.drop).toBe('bleed');
  });
  it('within 6 dB, a clearly stronger voice match for the other owner wins', () => {
    const { decision } = a().decide(sig({ channelRmsDb: { L: -20, R: -22 }, voice: { A: 0.2, B: 0.9 } }));
    expect(decision).toMatchObject({ participantKey: 'B', pending: false });
  });
  it('both talking at once: each channel keeps its owner as the candidate, overlap lowers confidence', () => {
    const at = a();
    const l = at.decide(sig({ channel: 'L', channelRmsDb: { L: -20, R: -22 }, overlap: true, voice: { A: 0.9 } })).decision;
    const r = at.decide(sig({ channel: 'R', channelRmsDb: { L: -22, R: -20 }, overlap: true, voice: { B: 0.9 } })).decision;
    expect([l.candidate, r.candidate]).toEqual(['A', 'B']);
    expect([l.pending, r.pending]).toEqual([true, true]);
    expect([l.participantKey, r.participantKey]).toEqual(['UNK', 'UNK']);
    expect(l.drop).toBeUndefined();
    expect(r.drop).toBeUndefined();
  });
  it('a dead channel is reported once and its owner falls back to voice', () => {
    const at = a();
    const n1 = at.tick(0, { L: false, R: true });
    const n2 = at.tick(61_000, { L: false, R: true });
    const n3 = at.tick(62_000, { L: false, R: true });
    expect([...n1, ...n2, ...n3].filter((n) => n.kind === 'dead_channel')).toEqual([{ kind: 'dead_channel', channel: 'L', participantKey: 'A' }]);
    // margin is now ignored: a low margin no longer drops or lowers the owner
    const d = at.decide(sig({ channelRmsDb: { L: -40, R: -20 }, voice: { A: 0.95 } })).decision;
    expect(d).toMatchObject({ participantKey: 'A', pending: false });
  });
  const killL = (at: Attributor) => {
    at.tick(0, { L: false, R: true });
    at.tick(61_000, { L: false, R: true });
  };
  it('a dead channel uses the best voice match, even when it names someone else', () => {
    const at = a();
    killL(at);
    const d = at.decide(sig({ voice: { A: 0.1, B: 0.95 } })).decision;
    expect(d).toMatchObject({ participantKey: 'B', pending: false });
  });
  it('a dead channel with no voice data is pending with the owner as candidate', () => {
    const at = a();
    killL(at);
    expect(at.decide(sig({ voice: {} })).decision).toMatchObject({ participantKey: 'UNK', candidate: 'A', pending: true });
  });
  it('a recovered channel is reported once and its margin applies again', () => {
    const at = a();
    killL(at);
    const back = at.tick(62_000, { L: true, R: false });
    expect(back).toEqual([{ kind: 'channel_recovered', channel: 'L', participantKey: 'A' }]);
    expect(at.tick(63_000, { L: true, R: false })).toEqual([]);
    expect(at.decide(sig({})).decision).toMatchObject({ participantKey: 'A', pending: false });
    expect(at.decide(sig({ channelRmsDb: { L: -30, R: -18 } })).decision.drop).toBe('bleed');
  });
  it('a later outage raises a new dead notice', () => {
    const at = a();
    killL(at);
    at.tick(62_000, { L: true, R: true });
    at.tick(63_000, { L: false, R: true });
    const again = at.tick(124_000, { L: false, R: true });
    expect(again.filter((n) => n.kind === 'dead_channel')).toHaveLength(1);
  });
  it('five confident mismatches suggest swapping the channel', () => {
    const at = a();
    let notices: unknown[] = [];
    for (let i = 0; i < 5; i++) notices = [...notices, ...at.decide(sig({ voice: { B: 0.8, A: 0.1 } })).notices];
    expect(notices).toContainEqual({ kind: 'swap_suggested', channel: 'L', participantKey: 'B' });
  });
  it('four mismatches are not enough', () => {
    const at = a();
    let notices: unknown[] = [];
    for (let i = 0; i < 4; i++) notices = [...notices, ...at.decide(sig({ voice: { B: 0.8, A: 0.1 } })).notices];
    expect(notices).toEqual([]);
  });
  it('applySwap exchanges the owners of two channels', () => {
    const at = a();
    at.applySwap('L', 'R');
    expect(at.decide(sig({})).decision.participantKey).toBe('B');
  });
});

describe('Attributor, one mixed feed', () => {
  it('strong voice match → that person; weak → UNK pending with a new voice notice', () => {
    const at = new Attributor('room', {});
    expect(at.decide(sig({ channel: null, channelRmsDb: {}, voice: { A: 0.92, B: 0.05 } })).decision).toMatchObject({ participantKey: 'A', pending: false });
    const weak = at.decide(sig({ channel: null, channelRmsDb: {}, voice: { A: 0.3, B: 0.2 } }));
    expect(weak.decision).toMatchObject({ participantKey: 'UNK', pending: true });
    expect(weak.notices[0]).toMatchObject({ kind: 'new_voice', label: 'Voice 1' });
  });
});
