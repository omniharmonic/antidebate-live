/**
 * One recording, end to end, in the host's tab (spec §6.4, §7). Every step checkpoints,
 * so closing the tab pauses rather than loses work: reopening resumes at the first
 * unfinished chunk, and utterance/event ids are deterministic, so nothing duplicates.
 */
import type { DomainEvent } from '@adl/core';
import type { EventLog } from '@adl/engine';
import { decodeToChannels } from '@/lib/audio/decode';
import { mergeChunkWords, planChunks, type Word } from '@/lib/asr/chunks';
import type { SpeakerSegment } from '@/lib/diarize/client';
import type { Checkpoint } from './checkpoint';
import { buildUtterances, splitIntoUtterances } from './utterances';

export type Stage =
  | { kind: 'decoding' }
  | { kind: 'separating' }
  | { kind: 'naming'; segments: SpeakerSegment[] }
  | { kind: 'transcribing'; done: number; total: number }
  | { kind: 'analysing'; processedMs: number; totalMs: number }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

export type Participant = Extract<DomainEvent, { type: 'session.started' }>['payload']['participants'][number];
export type HostLog = EventLog & { hydrate(): Promise<void>; close(): Promise<void> };

/** Utterances split at a pause of this length (matches splitIntoUtterances). */
const GAP_MS = 800;

/**
 * Words that can no longer change: those ending before the next chunk starts, minus the
 * trailing run, which may continue across the seam. The final chunk emits everything.
 */
export function settledWords(merged: Word[], nextChunkStartMs: number | undefined): Word[] {
  if (nextChunkStartMs === undefined) return merged;
  const runs = splitIntoUtterances(merged.filter((w) => w.endMs <= nextChunkStartMs), GAP_MS);
  return runs.slice(0, -1).flat();
}

export async function runRecording(o: {
  sessionId: string;
  file: File;
  asr: { transcribe(pcm: Float32Array, offsetMs: number): Promise<Word[]> };
  checkpoint: Pick<Checkpoint, 'outbox' | 'getChunk' | 'putChunk' | 'clearChunks' | 'getMeta' | 'putMeta'>;
  onStage: (s: Stage) => void;
  /** Speaker separation and the host's naming. Not called when the checkpoint already has a voice map for this file. */
  voices?: {
    separate(mono: Float32Array, numSpeakers: number | null): Promise<SpeakerSegment[]>;
    name(segments: SpeakerSegment[], mono: Float32Array, participants: Participant[]): Promise<Record<string, string | null>>;
  };
  engine: { start(log: HostLog): Promise<void> };
  makeLog: () => HostLog;
}): Promise<void> {
  let log: HostLog | null = null;
  try {
    log = o.makeLog();
    await log.hydrate();
    const known = (await log.read(0)).events;
    if (known.some((e) => e.type === 'session.ended')) {
      await log.close();
      o.onStage({ kind: 'done' });
      return;
    }

    o.onStage({ kind: 'decoding' });
    const { mono, durationMs } = await decodeToChannels(o.file);
    let meta = await o.checkpoint.getMeta();
    if (!meta || meta.fileSize !== o.file.size || meta.fileName !== o.file.name) {
      if (!o.voices) throw new Error('Speaker separation is not available on this page.');
      const start = known.find((e) => e.type === 'session.started');
      if (start?.type !== 'session.started') throw new Error('This session was not found on the server.');
      const participants = start.payload.participants.filter((p) => p.role !== 'audience');
      // Chunks saved for another file would be merged into this one's transcript.
      if (meta) await o.checkpoint.clearChunks();
      o.onStage({ kind: 'separating' });
      const segments = await o.voices.separate(mono, participants.length || null);
      o.onStage({ kind: 'naming', segments });
      const voiceMap = await o.voices.name(segments, mono, participants);
      meta = { fileName: o.file.name, fileSize: o.file.size, durationMs, segments, voiceMap };
      await o.checkpoint.putMeta(meta);
    }

    const plan = planChunks(durationMs);
    const results: { startMs: number; endMs: number; words: Word[] }[] = [];
    o.onStage({ kind: 'transcribing', done: 0, total: plan.length });
    for (const c of plan) {
      let words = await o.checkpoint.getChunk(c.index);
      if (!words) {
        words = await o.asr.transcribe(mono.subarray(Math.floor((c.startMs * 16_000) / 1000), Math.floor((c.endMs * 16_000) / 1000)), c.startMs);
        await o.checkpoint.putChunk(c.index, words);
      }
      results.push({ startMs: c.startMs, endMs: c.endMs, words });
      // Re-emitting earlier utterances is harmless: their ids derive from start times and the log drops repeats.
      const stable = settledWords(mergeChunkWords(results), plan[c.index + 1]?.startMs);
      await log.append(buildUtterances({ sessionId: o.sessionId, words: stable, segments: meta.segments, voiceMap: meta.voiceMap, mode: 'diarized', wallTs: new Date().toISOString() }));
      o.onStage({ kind: 'transcribing', done: c.index + 1, total: plan.length });
    }

    o.onStage({ kind: 'analysing', processedMs: 0, totalMs: durationMs });
    await o.engine.start(log);
    await log.close();
    o.onStage({ kind: 'done' });
  } catch (e) {
    // Unsent events stay in the outbox and go out on the next attempt.
    await log?.close().catch(() => {});
    o.onStage({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}
