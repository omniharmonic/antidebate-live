import { describe, expect, it } from 'vitest';
import type { DomainEvent } from '@adl/core';
import { deviceAction, latencyWarning, listenChannels, mappingComplete, noticeLine, pendingFromLog, statusLine, transcriptLines, visibleNotices } from './live-view';

const ctx = { channels: { d0c0: 'A', d0c1: 'B' }, names: { A: 'Ann', B: 'Bo' } };

const final = (id: string, key: string, text: string): DomainEvent =>
  ({ eventId: `s:${id}`, sessionId: 's', type: 'utterance.final', actor: 'system', mediaMs: 0, wallTs: '', payload: { utterance: { id, participantKey: key, startMs: 0, endMs: 1, text, words: [], attribution: { confidence: 0.5, signals: {}, confirmedBy: 'auto' }, overlapsWith: [] } } }) as DomainEvent;
const pending = (id: string, candidates: Record<string, number>): DomainEvent =>
  ({ eventId: `s:${id}:pending`, sessionId: 's', type: 'attribution.pending', actor: 'system', mediaMs: 0, wallTs: '', payload: { utteranceId: id, candidates } }) as DomainEvent;
const confirmed = (id: string, key: string): DomainEvent =>
  ({ eventId: `s:${id}:confirmed:1-1`, sessionId: 's', type: 'attribution.confirmed', actor: 'operator', mediaMs: 0, wallTs: '', payload: { utteranceId: id, participantKey: key } }) as DomainEvent;

describe('live view helpers', () => {
  it('says how many inputs and how far behind, to one decimal', () => {
    expect(statusLine(2, 1340)).toBe('Listening · 2 inputs · transcript about 1.3 s behind');
    expect(statusLine(1, null)).toBe('Listening · 1 input');
  });

  it('warns when the last three utterances were each more than 4 s behind', () => {
    const line = 'Transcription is running more than 4 seconds behind on this laptop. Close other apps, or switch to a faster laptop.';
    expect(latencyWarning([4100, 5000, 4500])).toBe(line);
    expect(latencyWarning([4100, 3900, 4500])).toBeNull();
    expect(latencyWarning([5000, 5000])).toBeNull();
    expect(latencyWarning([1000, 5000, 5000, 5000])).toBe(line);
  });

  it('words each notice with input numbers and names', () => {
    expect(noticeLine({ kind: 'dead_channel', channel: 'd0c0', participantKey: 'A' }, ctx)).toBe('Input 1 (Ann) has been silent for a minute while others speak. Ann will be identified by voice until it recovers.');
    expect(noticeLine({ kind: 'swap_suggested', channel: 'd0c0', participantKey: 'B' }, ctx)).toBe('Input 1 sounds like Bo. Swap inputs 1 and 2?');
    expect(noticeLine({ kind: 'channel_recovered', channel: 'd0c1', participantKey: 'B' }, ctx)).toBe('Input 2 (Bo) is working again.');
    expect(noticeLine({ kind: 'new_voice', label: 'Voice 1' }, ctx)).toBeNull();
  });

  it('hides dismissed notices, new voices, and a dead channel that has since recovered', () => {
    const list = [
      { kind: 'dead_channel' as const, channel: 'd0c0', participantKey: 'A' },
      { kind: 'swap_suggested' as const, channel: 'd0c1', participantKey: 'A' },
      { kind: 'new_voice' as const, label: 'Voice 1' },
      { kind: 'channel_recovered' as const, channel: 'd0c0', participantKey: 'A' },
      { kind: 'dead_channel' as const, channel: 'd0c1', participantKey: 'B' },
    ];
    expect(visibleNotices(list, new Set([1])).map((n) => n.index)).toEqual([3, 4]);
  });

  it('segments each mapped mic in the tracks setup, else the one feed', () => {
    expect(listenChannels({ kind: 'tracks', channels: { d0c1: 'B', d0c0: 'A' } })).toEqual(['d0c0', 'd0c1']);
    expect(listenChannels({ kind: 'room', channels: {} })).toEqual(['d0c0']);
  });

  it('adds devices until every debater can have an input, and replaces a device with problems', () => {
    expect(deviceAction([], 2)).toBe('use');
    expect(deviceAction([{ channels: 2, problems: 0 }], 2)).toBe('replace');
    expect(deviceAction([{ channels: 1, problems: 0 }], 2)).toBe('add');
    expect(deviceAction([{ channels: 1, problems: 0 }, { channels: 1, problems: 0 }], 2)).toBe('replace');
    expect(deviceAction([{ channels: 2, problems: 0 }], 3)).toBe('add');
    expect(deviceAction([{ channels: 1, problems: 0 }, { channels: 2, problems: 1 }], 2)).toBe('replace');
  });

  it('needs every debater on exactly one input', () => {
    expect(mappingComplete({ d0c0: 'A', d0c1: 'B' }, ['A', 'B'])).toBe(true);
    expect(mappingComplete({ d0c0: 'A', d0c1: '' }, ['A', 'B'])).toBe(false);
    expect(mappingComplete({ d0c0: 'A', d0c1: 'A', d1c0: 'B' }, ['A', 'B'])).toBe(false);
    expect(mappingComplete({ d0c0: 'A', d0c1: 'B', d1c0: 'MOD' }, ['A', 'B'])).toBe(true);
  });

  it('finds the lines still waiting for the host in a hydrated log', () => {
    const events = [pending('u1', { A: 0.6 }), final('u1', 'UNK', 'first'), pending('u2', {}), final('u2', 'UNK', 'second'), confirmed('u2', 'B'), final('u3', 'A', 'sure')];
    expect(pendingFromLog(events)).toEqual([{ utteranceId: 'u1', text: 'first', candidates: { A: 0.6 } }]);
  });

  it('lists transcript lines with names, confirmed speakers applied, the unsure marked', () => {
    const events = [final('u1', 'A', 'hello'), pending('u2', { B: 0.7 }), final('u2', 'UNK', 'maybe'), pending('u3', {}), final('u3', 'UNK', 'later'), confirmed('u3', 'B')];
    expect(transcriptLines(events, ctx.names, 10)).toEqual([
      { id: 'u1', speaker: 'Ann', text: 'hello' },
      { id: 'u2', speaker: 'Not sure (Bo?)', text: 'maybe' },
      { id: 'u3', speaker: 'Bo', text: 'later' },
    ]);
    expect(transcriptLines(events, ctx.names, 1).map((l) => l.id)).toEqual(['u3']);
  });
});
