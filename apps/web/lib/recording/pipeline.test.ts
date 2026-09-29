import { describe, expect, it, vi } from 'vitest';
import type { DomainEvent } from '@adl/core';
import { MemoryOutbox } from '@adl/engine';
import type { Word } from '@/lib/asr/chunks';
import { runRecording, type Stage } from './pipeline';
import type { RecordingMeta } from './checkpoint';

const decoded = vi.hoisted(() => ({ durationMs: 130_000 }));
vi.mock('@/lib/audio/decode', () => ({
  decodeToChannels: async () => {
    const n = (16_000 * decoded.durationMs) / 1000;
    return { channels: [new Float32Array(n)], mono: new Float32Array(n), durationMs: decoded.durationMs };
  },
}));

const oneVoice = (durationMs: number): RecordingMeta => ({ fileName: 'f', fileSize: 1, durationMs, segments: [{ startMs: 0, endMs: durationMs, label: 'S0', confidence: 0.9 }], voiceMap: { S0: 'A' } });

function memCheckpoint(done: number[], meta: RecordingMeta | null) {
  const chunks = new Map<number, Word[]>(done.map((i) => [i, [{ text: `c${i}`, startMs: i * 56_000 + 1000, endMs: i * 56_000 + 1300 }]]));
  let m = meta;
  return {
    outbox: new MemoryOutbox(),
    getChunk: async (i: number) => chunks.get(i) ?? null,
    putChunk: async (i: number, w: Word[]) => void chunks.set(i, w),
    getMeta: async () => m,
    putMeta: async (x: RecordingMeta) => void (m = x),
    clearChunks: async () => chunks.clear(),
    get meta() { return m; },
  };
}

/** A log that records every append as-is (no dedupe), preloaded with `initial`; `waiting` events never upload. */
function recordingLog(initial: DomainEvent[] = [], waiting = 0) {
  const appended: DomainEvent[] = [];
  const status = () => ({ pending: waiting, lastError: waiting ? 'The server returned 503' : null });
  return {
    appended,
    log: { kind: 'http' as const, where: 'mem', append: async (e: DomainEvent[]) => void appended.push(...e), read: async (c: number) => ({ cursor: initial.length, events: initial.slice(c) }), logCall: async () => {}, hydrate: async () => {}, close: async () => waiting, status },
  };
}
const finished = async () => 'finished' as const;

const started = { eventId: 's:start', sessionId: 's', type: 'session.started', actor: 'operator', mediaMs: 0, wallTs: 'w', payload: { title: 't', format: 'anti-debate', participants: [{ key: 'A', displayName: 'Ann', role: 'debater' }, { key: 'B', displayName: 'Bo', role: 'debater' }, { key: 'MOD', displayName: 'Mo', role: 'moderator' }] } } as DomainEvent;

describe('runRecording', () => {
  it('resumes: only unfinished chunks are transcribed', async () => {
    decoded.durationMs = 130_000;
    const transcribe = vi.fn(async (_pcm: Float32Array, offsetMs: number) => [{ text: 'w', startMs: offsetMs + 2000, endMs: offsetMs + 2300 }]);
    const stages: Stage['kind'][] = [];
    const appended: string[] = [];
    await runRecording({
      sessionId: 's',
      file: new File([new Uint8Array(1)], 'f'),
      asr: { transcribe },
      checkpoint: memCheckpoint([0, 1], oneVoice(130_000)),
      onStage: (s) => stages.push(s.kind),
      engine: { start: async (log) => { appended.push(...(await log.read(0)).events.map((e) => e.eventId)); return 'finished'; } },
      makeLog: () => ({ kind: 'http', where: 'mem', append: async (e) => void appended.push(...e.map((x) => x.eventId)), read: async () => ({ cursor: 0, events: [] }), logCall: async () => {}, hydrate: async () => {}, close: async () => 0, status: () => ({ pending: 0, lastError: null }) }),
    });
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(transcribe.mock.calls[0]![1]).toBe(112_000);
    expect(stages).not.toContain('naming');
    expect(stages.at(-1)).toBe('done');
  });

  it('an utterance spanning a chunk seam is emitted once, whole', async () => {
    decoded.durationMs = 100_000; // chunks [0, 60 s] and [56 s, 100 s]
    const speech = (from: number, to: number): Word[] => {
      const out: Word[] = [];
      for (let t = from; t + 250 <= to; t += 300) out.push({ text: `w${t}`, startMs: t, endMs: t + 250 });
      return out;
    };
    const transcribe = async (_pcm: Float32Array, offsetMs: number) => (offsetMs === 0 ? [...speech(1000, 3000), ...speech(50_000, 60_000)] : speech(56_000, 64_000));
    const { log, appended } = recordingLog();
    const stages: Stage[] = [];
    await runRecording({ sessionId: 's', file: new File([new Uint8Array(1)], 'f'), asr: { transcribe }, checkpoint: memCheckpoint([], oneVoice(100_000)), onStage: (s) => stages.push(s), engine: { start: finished }, makeLog: () => log });
    expect(stages.at(-1)).toEqual({ kind: 'done' });
    const finals = appended.filter((e) => e.type === 'utterance.final' && e.payload.utterance.id === 'u50000');
    expect(finals).toHaveLength(1);
    const u = finals[0]!.type === 'utterance.final' ? finals[0]!.payload.utterance : null;
    expect(u?.endMs).toBe(63_750);
    // The earlier, finished utterance may re-emit under its own id; the log drops the copy.
    expect(new Set(appended.filter((e) => e.type === 'utterance.final').map((e) => e.eventId))).toEqual(new Set(['s:u1000', 's:u50000']));
  });

  it('separates and waits for naming when nothing is cached, then saves the voice map', async () => {
    decoded.durationMs = 30_000;
    const cp = memCheckpoint([], null);
    const stages: Stage['kind'][] = [];
    const separate = vi.fn(async () => [{ startMs: 0, endMs: 30_000, label: 'S0', confidence: 0.9 }]);
    const name = vi.fn<(s: unknown, m: Float32Array, p: unknown[]) => Promise<Record<string, string>>>(async () => ({ S0: 'A' }));
    const { log } = recordingLog([started]);
    await runRecording({ sessionId: 's', file: new File([new Uint8Array(3)], 'talk.mp4'), asr: { transcribe: async () => [] }, checkpoint: cp, onStage: (s) => stages.push(s.kind), voices: { separate, name }, engine: { start: finished }, makeLog: () => log });
    expect(separate).toHaveBeenCalledWith(expect.any(Float32Array));
    expect(name.mock.calls[0]![2]).toHaveLength(3);
    expect(stages.slice(0, 4)).toEqual(['decoding', 'separating', 'naming', 'transcribing']);
    expect(cp.meta).toMatchObject({ fileName: 'talk.mp4', fileSize: 3, durationMs: 30_000, voiceMap: { S0: 'A' }, transcribed: true });
  });

  it('a different file discards the old transcript chunks before starting again', async () => {
    decoded.durationMs = 100_000; // two chunks
    const cp = memCheckpoint([0, 1], { ...oneVoice(100_000), fileName: 'old.mp4', fileSize: 99 });
    const transcribe = vi.fn(async () => []);
    const { log } = recordingLog([started]);
    const stages: Stage['kind'][] = [];
    await runRecording({ sessionId: 's', file: new File([new Uint8Array(3)], 'new.mp4'), asr: { transcribe }, checkpoint: cp, onStage: (s) => stages.push(s.kind), voices: { separate: async () => [], name: async () => ({}) }, engine: { start: finished }, makeLog: () => log });
    expect(stages.at(-1)).toBe('done');
    expect(transcribe).toHaveBeenCalledTimes(2);
    expect(cp.meta).toMatchObject({ fileName: 'new.mp4', fileSize: 3 });
  });

  it('a session that already ended goes straight to done', async () => {
    const transcribe = vi.fn(async () => []);
    const ended = { eventId: 's:end', sessionId: 's', type: 'session.ended', actor: 'system', mediaMs: 0, wallTs: 'w', payload: {} } as DomainEvent;
    const { log } = recordingLog([started, ended]);
    const stages: Stage['kind'][] = [];
    await runRecording({ sessionId: 's', file: new File([new Uint8Array(1)], 'f'), asr: { transcribe }, checkpoint: memCheckpoint([], null), onStage: (s) => stages.push(s.kind), engine: { start: finished }, makeLog: () => log });
    expect(stages).toEqual(['done']);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('reports a failure as an error stage', async () => {
    decoded.durationMs = 30_000;
    const stages: Stage[] = [];
    const { log } = recordingLog([started]);
    await runRecording({ sessionId: 's', file: new File([new Uint8Array(1)], 'f'), asr: { transcribe: async () => { throw new Error('worker stopped'); } }, checkpoint: memCheckpoint([], oneVoice(30_000)), onStage: (s) => stages.push(s), engine: { start: finished }, makeLog: () => log });
    expect(stages.at(-1)).toEqual({ kind: 'error', message: 'worker stopped' });
  });

  const said = (id: string, endMs: number) => ({ eventId: `s:${id}`, sessionId: 's', type: 'utterance.final', actor: 'system', mediaMs: endMs, wallTs: 'w', payload: { utterance: { id, participantKey: 'A', startMs: endMs - 1000, endMs, text: 'x', words: [], attribution: { confidence: 0.9, signals: {}, confirmedBy: 'auto' }, overlapsWith: [] } } }) as DomainEvent;

  it('no progress on this device but the transcript is on the server: straight to analysis', async () => {
    const transcribe = vi.fn(async () => []);
    const separate = vi.fn(async () => []);
    const stages: Stage[] = [];
    const { log } = recordingLog([started, said('u1000', 2000), said('u90000', 91_000)]);
    const start = vi.fn(finished);
    await runRecording({ sessionId: 's', file: new File([new Uint8Array(3)], 'talk.mp4'), asr: { transcribe }, checkpoint: memCheckpoint([], null), onStage: (s) => stages.push(s), voices: { separate, name: async () => ({}) }, engine: { start }, makeLog: () => log });
    expect(separate).not.toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledTimes(1);
    expect(stages).toEqual([{ kind: 'analysing', processedMs: 0, totalMs: 91_000 }, { kind: 'done' }]);
  });

  it('a finished transcript on this device resumes analysis without the file', async () => {
    const stages: Stage['kind'][] = [];
    const { log } = recordingLog([started]);
    const start = vi.fn(finished);
    await runRecording({ sessionId: 's', file: null, asr: { transcribe: async () => [] }, checkpoint: memCheckpoint([], { ...oneVoice(30_000), transcribed: true }), onStage: (s) => stages.push(s.kind), engine: { start }, makeLog: () => log });
    expect(start).toHaveBeenCalledTimes(1);
    expect(stages).toEqual(['analysing', 'done']);
  });

  it('without the file and with transcription unfinished, asks for the file', async () => {
    const stages: Stage[] = [];
    const { log } = recordingLog([started]);
    await runRecording({ sessionId: 's', file: null, asr: { transcribe: async () => [] }, checkpoint: memCheckpoint([0], oneVoice(100_000)), onStage: (s) => stages.push(s), engine: { start: finished }, makeLog: () => log });
    expect(stages.at(-1)).toEqual({ kind: 'error', message: 'Choose the recording file to continue.' });
  });

  it('is not done while events are waiting to upload', async () => {
    decoded.durationMs = 30_000;
    const stages: Stage[] = [];
    const { log } = recordingLog([started], 2);
    await runRecording({ sessionId: 's', file: new File([new Uint8Array(1)], 'f'), asr: { transcribe: async () => [] }, checkpoint: memCheckpoint([], oneVoice(30_000)), onStage: (s) => stages.push(s), engine: { start: finished }, makeLog: () => log });
    expect(stages.at(-1)).toEqual({ kind: 'uploading', pending: 2, lastError: 'The server returned 503' });
    expect(stages.map((s) => s.kind)).not.toContain('done');
  });

  it('a rejected key stops at key-rejected, not done', async () => {
    const stages: Stage['kind'][] = [];
    const { log } = recordingLog([started]);
    await runRecording({ sessionId: 's', file: null, asr: { transcribe: async () => [] }, checkpoint: memCheckpoint([], { ...oneVoice(30_000), transcribed: true }), onStage: (s) => stages.push(s.kind), engine: { start: async () => 'key-rejected' as const }, makeLog: () => log });
    expect(stages).toEqual(['analysing', 'key-rejected']);
  });
  describe('review of unsure lines', () => {
    const noVoices = (durationMs: number): RecordingMeta => ({ fileName: 'f', fileSize: 1, durationMs, segments: [], voiceMap: {} });
    const held = (id: string, endMs: number, diarLabel?: string) => [
      { eventId: `s:${id}:pending`, sessionId: 's', type: 'attribution.pending', actor: 'system', mediaMs: endMs, wallTs: 'w', payload: { utteranceId: id, candidates: {} } },
      { eventId: `s:${id}`, sessionId: 's', type: 'utterance.final', actor: 'system', mediaMs: endMs, wallTs: 'w', payload: { utterance: { id, participantKey: 'UNK', startMs: endMs - 1000, endMs, text: `line ${id}`, words: [], attribution: { confidence: 0.6, signals: diarLabel ? { diarLabel } : {}, confirmedBy: 'auto' }, overlapsWith: [] } } },
    ] as DomainEvent[];

    it('asks the host about pending lines and confirms the ones they assign', async () => {
      decoded.durationMs = 130_000;
      const { log, appended } = recordingLog([started]);
      let asked = 0;
      // One word per chunk, each inside the span its chunk owns after the overlap merge.
      const cp = memCheckpoint([], noVoices(130_000));
      for (const [i, t] of [1000, 70_000, 120_000].entries()) await cp.putChunk(i, [{ text: `w${i}`, startMs: t, endMs: t + 300 }]);
      const stages: Stage['kind'][] = [];
      await runRecording({
        sessionId: 's', file: new File([new Uint8Array(1)], 'f'),
        asr: { transcribe: async () => [] }, checkpoint: cp, onStage: (s) => stages.push(s.kind),
        review: async (p) => { asked = p.length; return p.slice(0, 1).map((x) => ({ utteranceId: x.utteranceId, participantKey: 'A' })); },
        engine: { start: finished }, makeLog: () => log,
      });
      expect(asked).toBe(3);
      const confirms = appended.filter((e) => e.type === 'attribution.confirmed');
      expect(confirms).toHaveLength(1);
      expect(confirms[0]).toMatchObject({ actor: 'operator', eventId: 's:u1000:confirm', mediaMs: 1300, payload: { utteranceId: 'u1000', participantKey: 'A' } });
      expect(stages.slice(stages.indexOf('transcribing'))).toEqual(['transcribing', 'transcribing', 'transcribing', 'transcribing', 'review', 'analysing', 'done']);
    });

    it('confirms before the engine starts', async () => {
      decoded.durationMs = 30_000;
      const { log, appended } = recordingLog([started]);
      let seenAtStart = 0;
      await runRecording({
        sessionId: 's', file: new File([new Uint8Array(1)], 'f'),
        asr: { transcribe: async () => [{ text: 'hi', startMs: 1000, endMs: 1300 }] }, checkpoint: memCheckpoint([], noVoices(30_000)), onStage: () => {},
        review: async (p) => p.map((x) => ({ utteranceId: x.utteranceId, participantKey: 'B' })),
        engine: { start: async () => { seenAtStart = appended.filter((e) => e.type === 'attribution.confirmed').length; return 'finished'; } }, makeLog: () => log,
      });
      expect(seenAtStart).toBe(1);
    });

    it('does not ask when nothing is pending, or when no review is wired', async () => {
      decoded.durationMs = 30_000;
      const review = vi.fn(async () => []);
      const { log } = recordingLog([started]);
      await runRecording({ sessionId: 's', file: new File([new Uint8Array(1)], 'f'), asr: { transcribe: async () => [{ text: 'hi', startMs: 1000, endMs: 1300 }] }, checkpoint: memCheckpoint([], oneVoice(30_000)), onStage: () => {}, review, engine: { start: finished }, makeLog: () => log });
      expect(review).not.toHaveBeenCalled();
      const b = recordingLog([started]);
      const stages: Stage['kind'][] = [];
      await runRecording({ sessionId: 's', file: new File([new Uint8Array(1)], 'f'), asr: { transcribe: async () => [{ text: 'hi', startMs: 1000, endMs: 1300 }] }, checkpoint: memCheckpoint([], noVoices(30_000)), onStage: (s) => stages.push(s.kind), engine: { start: finished }, makeLog: () => b.log });
      expect(stages).not.toContain('review');
    });

    it('unassigned lines get no confirmation and stay pending', async () => {
      decoded.durationMs = 30_000;
      const { log, appended } = recordingLog([started]);
      await runRecording({ sessionId: 's', file: new File([new Uint8Array(1)], 'f'), asr: { transcribe: async () => [{ text: 'hi', startMs: 1000, endMs: 1300 }] }, checkpoint: memCheckpoint([], noVoices(30_000)), onStage: () => {}, review: async () => [], engine: { start: finished }, makeLog: () => log });
      expect(appended.some((e) => e.type === 'attribution.confirmed')).toBe(false);
    });

    it('on resume from the log, reads pending lines from the log (minus confirmed) with their voice label and no audio', async () => {
      const confirmed = { eventId: 's:u2000:confirm', sessionId: 's', type: 'attribution.confirmed', actor: 'operator', mediaMs: 2000, wallTs: 'w', payload: { utteranceId: 'u2000', participantKey: 'A' } } as DomainEvent;
      const { log, appended } = recordingLog([started, ...held('u1000', 1000, 'S1'), ...held('u2000', 2000), ...held('u3000', 3000), confirmed]);
      let got: { utteranceId: string; diarLabel?: string; candidates: Record<string, number> }[] = [];
      let audio: Float32Array | null | undefined;
      await runRecording({
        sessionId: 's', file: null, asr: { transcribe: async () => [] }, checkpoint: memCheckpoint([], null), onStage: () => {},
        review: async (p, mono, people) => { got = p; audio = mono; expect(people.map((x) => x.key)).toEqual(['A', 'B', 'MOD']); return [{ utteranceId: 'u3000', participantKey: 'B' }]; },
        engine: { start: finished }, makeLog: () => log,
      });
      expect(got.map((l) => l.utteranceId)).toEqual(['u1000', 'u3000']);
      expect(got[0]).toMatchObject({ diarLabel: 'S1', text: 'line u1000', startMs: 0, endMs: 1000, candidates: {} });
      expect(got[1]!.diarLabel).toBeUndefined();
      expect(audio).toBeNull();
      expect(appended.filter((e) => e.type === 'attribution.confirmed').map((e) => e.eventId)).toEqual(['s:u3000:confirm']);
    });

    it('a normal run passes the decoded audio for listening', async () => {
      decoded.durationMs = 30_000;
      const { log } = recordingLog([started]);
      let audio: Float32Array | null | undefined;
      await runRecording({ sessionId: 's', file: new File([new Uint8Array(1)], 'f'), asr: { transcribe: async () => [{ text: 'hi', startMs: 1000, endMs: 1300 }] }, checkpoint: memCheckpoint([], noVoices(30_000)), onStage: () => {}, review: async (_p, mono) => { audio = mono; return []; }, engine: { start: finished }, makeLog: () => log });
      expect(audio).toBeInstanceOf(Float32Array);
    });
  });
});
