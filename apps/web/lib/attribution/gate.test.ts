import { describe, expect, it } from 'vitest';
import { capVoiceOnly, gateFor, hostConfirmsNote, VOICE_ONLY_CAP } from './gate';

describe('gateFor', () => {
  it('never lowers the threshold below 0.85', () => {
    for (const s of ['tracks', 'call', 'room', 'recording'] as const) expect(gateFor(s).threshold).toBeGreaterThanOrEqual(0.85);
  });
  it('clamps a measured threshold to 0.85 and falls back when a setup was not measured', () => {
    expect(gateFor('call', { call: { threshold: 0.5, hostConfirmsAll: false } })).toEqual({ threshold: 0.85, hostConfirmsAll: false });
    expect(gateFor('room', { call: { threshold: 0.9, hostConfirmsAll: false } })).toEqual({ threshold: 0.85, hostConfirmsAll: false });
    expect(gateFor('recording', { recording: { threshold: 0.99, hostConfirmsAll: true } })).toEqual({ threshold: 0.99, hostConfirmsAll: true });
  });
});

describe('capVoiceOnly', () => {
  it('caps call and room unless the gate measured that setup and it passed', () => {
    expect(capVoiceOnly('room', 1, {})).toBe(VOICE_ONLY_CAP);
    expect(capVoiceOnly('room', 1, { room: { threshold: 0.99, hostConfirmsAll: true } })).toBe(VOICE_ONLY_CAP);
    expect(capVoiceOnly('room', 1, { room: { threshold: 0.85, hostConfirmsAll: false } })).toBe(1);
    expect(capVoiceOnly('call', 1, { room: { threshold: 0.85, hostConfirmsAll: false } })).toBe(VOICE_ONLY_CAP);
  });
  it('never caps tracks', () => {
    expect(capVoiceOnly('tracks', 1, {})).toBe(1);
  });
});

describe('hostConfirmsNote', () => {
  it('tells the host only where the gate says the host confirms every line', () => {
    expect(hostConfirmsNote('room', { room: { threshold: 0.99, hostConfirmsAll: true } })).toBe('In this setup, the host confirms who is speaking before a line enters the map.');
    expect(hostConfirmsNote('room', { room: { threshold: 0.85, hostConfirmsAll: false } })).toBeNull();
    expect(hostConfirmsNote('recording', {})).toBeNull();
  });
});
