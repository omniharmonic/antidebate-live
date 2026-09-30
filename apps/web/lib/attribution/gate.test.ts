import { describe, expect, it } from 'vitest';
import { capVoiceOnly, gateFor, hostConfirmsNote, VOICE_ONLY_CAP } from './gate';

describe('gateFor', () => {
  it('never lowers the threshold below 0.85', () => {
    for (const s of ['tracks', 'call', 'room', 'recording'] as const) expect(gateFor(s).threshold).toBeGreaterThanOrEqual(0.85);
  });
  it('clamps a measured threshold to 0.85 and falls back when a setup was not measured', () => {
    expect(gateFor('call', { call: { threshold: 0.5, hostConfirmsAll: false } })).toEqual({ threshold: 0.85, hostConfirmsAll: false, insufficient: false });
    expect(gateFor('room', { call: { threshold: 0.9, hostConfirmsAll: false } })).toEqual({ threshold: 0.85, hostConfirmsAll: false, insufficient: false });
    expect(gateFor('recording', { recording: { threshold: 0.99, hostConfirmsAll: true } })).toEqual({ threshold: 0.99, hostConfirmsAll: true, insufficient: false });
  });
  it('exposes a measured sample too small to count as passed (P3-R7)', () => {
    expect(gateFor('room', { room: { threshold: 0.85, hostConfirmsAll: false, insufficient: true } })).toEqual({ threshold: 0.85, hostConfirmsAll: false, insufficient: true });
  });
});

describe('capVoiceOnly', () => {
  it('caps call and room unless the gate measured that setup and it passed', () => {
    expect(capVoiceOnly('room', 1, {})).toBe(VOICE_ONLY_CAP);
    expect(capVoiceOnly('room', 1, { room: { threshold: 0.99, hostConfirmsAll: true } })).toBe(VOICE_ONLY_CAP);
    expect(capVoiceOnly('room', 1, { room: { threshold: 0.85, hostConfirmsAll: false } })).toBe(1);
    expect(capVoiceOnly('call', 1, { room: { threshold: 0.85, hostConfirmsAll: false } })).toBe(VOICE_ONLY_CAP);
  });
  it('stays applied where the measured sample was insufficient (P3-R7)', () => {
    expect(capVoiceOnly('room', 1, { room: { threshold: 0.85, hostConfirmsAll: false, insufficient: true } })).toBe(VOICE_ONLY_CAP);
  });
  it('with the measured gate.json, call and room keep the cap', () => {
    expect(capVoiceOnly('call', 1)).toBe(VOICE_ONLY_CAP);
    expect(capVoiceOnly('room', 1)).toBe(VOICE_ONLY_CAP);
  });
  it('never caps tracks', () => {
    expect(capVoiceOnly('tracks', 1, {})).toBe(1);
  });
  it('always caps voice-only decisions in tracks (a dead mic): the gate never measures them (P3-R10)', () => {
    expect(capVoiceOnly('tracks-voice', 1, {})).toBe(VOICE_ONLY_CAP);
    expect(capVoiceOnly('tracks-voice', 1, { tracks: { threshold: 0.85, hostConfirmsAll: false } })).toBe(VOICE_ONLY_CAP);
    expect(capVoiceOnly('tracks-voice', 0.7, {})).toBe(0.7);
  });
  it('keeps call capped while its entry was measured on a room mix, even if that passed (P3-R10)', () => {
    const table = { call: { threshold: 0.85, hostConfirmsAll: false, measuredFrom: 'room-mix' as const } };
    expect(gateFor('call', table)).toEqual({ threshold: 0.85, hostConfirmsAll: false, insufficient: true });
    expect(capVoiceOnly('call', 1, table)).toBe(VOICE_ONLY_CAP);
  });
});

describe('the committed gate.json', () => {
  it('marks call as measured from the room mix, so call is insufficient', () => {
    expect(gateFor('call').insufficient).toBe(true);
  });
});

describe('hostConfirmsNote', () => {
  it('tells the host only where the gate says the host confirms every line', () => {
    expect(hostConfirmsNote('room', { room: { threshold: 0.99, hostConfirmsAll: true } })).toBe('In this setup, the host confirms who is speaking before a line enters the map.');
    expect(hostConfirmsNote('room', { room: { threshold: 0.85, hostConfirmsAll: false } })).toBeNull();
    expect(hostConfirmsNote('recording', {})).toBeNull();
  });
});
