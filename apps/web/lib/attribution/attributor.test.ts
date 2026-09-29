import { describe, expect, it } from 'vitest';
import { Attributor, type UtteranceSignals } from './attributor';
import { fuse } from './fusion';
import { VOICE_ONLY_CAP } from './gate';

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

describe('Attributor, tracks with voice agreement (P2-R8)', () => {
  it('an unmiked moderator on debater A\'s mic at a 14 dB margin is held, not given to A', () => {
    const at = new Attributor('tracks', { L: 'A', R: 'B' }, { unmiked: true });
    const { decision } = at.decide(sig({ channelRmsDb: { L: -20, R: -34 }, voice: { A: 0.05, B: 0, M: 0.9 } }));
    expect(decision).toMatchObject({ participantKey: 'UNK', pending: true, candidate: 'A' });
    expect(Object.keys(decision.candidates!).sort()).toEqual(['A', 'M']);
    expect(decision.confidence).toBeLessThan(0.85);
  });
  it('everyone miked and enrolled: a clean margin with the owner\'s voice agreeing auto-accepts', () => {
    const at = new Attributor('tracks', { L: 'A', R: 'B' });
    expect(at.decide(sig({ channelRmsDb: { L: -20, R: -34 }, voice: { A: 0.8, B: 0.1 } })).decision).toMatchObject({ participantKey: 'A', pending: false });
  });
  it('the owner is best but below half the utterance: held', () => {
    const at = new Attributor('tracks', { L: 'A', R: 'B' });
    expect(at.decide(sig({ channelRmsDb: { L: -20, R: -34 }, voice: { A: 0.4, B: 0.1 } })).decision).toMatchObject({ participantKey: 'UNK', pending: true });
  });
  it('someone unmiked and no voice data: a clean margin is held', () => {
    const at = new Attributor('tracks', { L: 'A', R: 'B' }, { unmiked: true });
    expect(at.decide(sig({ channelRmsDb: { L: -20, R: -34 } })).decision).toMatchObject({ participantKey: 'UNK', candidate: 'A', pending: true });
  });
  it('all-zero voice scores are not diarizer agreement', () => {
    const at = new Attributor('tracks', { L: 'A', R: 'B' });
    const { decision } = at.decide(sig({ channelRmsDb: { L: -20, R: -23 }, voice: { A: 0, B: 0 } }));
    expect(decision.confidence).toBe(fuse({ channelMarginDb: 3, voiceMatch: 0, diarizerAgrees: null, overlap: false }));
  });
  it('sampled voice matches at clear margins raise a swap after five mismatches', () => {
    const at = new Attributor('tracks', { L: 'A', R: 'B' });
    const notices = Array.from({ length: 5 }, () => at.observeVoice('L', { A: 0.1, B: 0.8 })).flat();
    expect(notices).toEqual([{ kind: 'swap_suggested', channel: 'L', participantKey: 'B' }]);
  });
  it('bleed is decided from levels alone', () => {
    const at = new Attributor('tracks', { L: 'A', R: 'B' });
    expect(at.isBleed('R', { L: -18, R: -30 })).toBe(true);
    expect(at.isBleed('R', { L: -18, R: -22 })).toBe(false);
  });
});

describe('Attributor, one mixed feed', () => {
  for (const setup of ['room', 'call'] as const) {
    it(`${setup}: unmeasured, a voice-only decision is capped below the threshold, so it is held (P2-R9)`, () => {
      const at = new Attributor(setup, {}, { gates: {} });
      const { decision } = at.decide(sig({ channel: null, channelRmsDb: {}, voice: { A: 0.99, B: 0.01 } }));
      expect(decision).toMatchObject({ participantKey: 'UNK', candidate: 'A', pending: true, confidence: VOICE_ONLY_CAP });
    });
    it(`${setup}: once the gate passes for it, the cap is lifted`, () => {
      const at = new Attributor(setup, {}, { gates: { [setup]: { threshold: 0.85, hostConfirmsAll: false } } });
      const { decision } = at.decide(sig({ channel: null, channelRmsDb: {}, voice: { A: 0.99, B: 0.01 } }));
      expect(decision).toMatchObject({ participantKey: 'A', pending: false });
    });
  }
  it('weak → UNK pending with a new voice notice', () => {
    const at = new Attributor('room', {});
    const weak = at.decide(sig({ channel: null, channelRmsDb: {}, voice: { A: 0.3, B: 0.2 } }));
    expect(weak.decision).toMatchObject({ participantKey: 'UNK', pending: true });
    expect(weak.notices[0]).toMatchObject({ kind: 'new_voice', label: 'Voice 1' });
  });
});

describe('Attributor, measured gate', () => {
  const clean = sig({ voice: { A: 0.9 } });
  it('holds a line below the setup threshold', () => {
    const fused = new Attributor('tracks', { L: 'A', R: 'B' }, { gates: {} }).decide(clean).decision;
    expect(fused.pending).toBe(false);
    const strict = new Attributor('tracks', { L: 'A', R: 'B' }, { gates: { tracks: { threshold: fused.confidence + 0.01, hostConfirmsAll: false } } });
    expect(strict.decide(clean).decision).toMatchObject({ participantKey: 'UNK', candidate: 'A', pending: true });
  });
  it('holds every line where the host confirms all', () => {
    const at = new Attributor('tracks', { L: 'A', R: 'B' }, { gates: { tracks: { threshold: 0.99, hostConfirmsAll: true } } });
    expect(at.decide(sig({ channelRmsDb: { L: -10, R: -40 }, voice: { A: 1 } })).decision).toMatchObject({ participantKey: 'UNK', pending: true });
  });
});
