/**
 * One recording, end to end, in the host's tab (spec §6.4, §7). Every step checkpoints,
 * so closing the tab pauses rather than loses work: reopening resumes at the first
 * unfinished chunk, and utterance/event ids are deterministic, so nothing duplicates.
 */
import type { DomainEvent } from '@adl/core';
import type { EventLog, UploadStatus } from '@adl/engine';
import { decodeToChannels } from '@/lib/audio/decode';
import { mergeChunkWords, planChunks, type Word } from '@/lib/asr/chunks';
import type { SpeakerSegment } from '@/lib/diarize/client';
import type { Checkpoint, RecordingMeta } from './checkpoint';
import { buildUtterances, splitIntoUtterances } from './utterances';

export type Stage =
  | { kind: 'decoding' }
  | { kind: 'separating'; audioMs: number }
  | { kind: 'naming'; segments: SpeakerSegment[] }
  | { kind: 'transcribing'; done: number; total: number }
  | { kind: 'analysing'; processedMs: number; totalMs: number }
  /** Everything ran, but some events have not reached the server yet. */
  | ({ kind: 'uploading' } & UploadStatus)
  /** Anthropic refused the host's key (401/403): analysis stopped, the session is not finished. */
  | { kind: 'key-rejected' }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

export type Participant = Extract<DomainEvent, { type: 'session.started' }>['payload']['participants'][number];
export type HostLog = EventLog & { hydrate(): Promise<void>; close(): Promise<number>; status(): UploadStatus };
export type EngineOutcome = 'finished' | 'key-rejected';

type Options = {
  sessionId: string;
  /** Null when resuming analysis only: the transcript is already in the log. */
  file: File | null;
  asr: { transcribe(pcm: Float32Array, offsetMs: number): Promise<Word[]> };
  checkpoint: Pick<Checkpoint, 'outbox' | 'getChunk' | 'putChunk' | 'clearChunks' | 'getMeta' | 'putMeta'>;
  onStage: (s: Stage) => void;
  /** Speaker separation and the host's naming. Not called when the checkpoint already has a voice map for this file. */
  voices?: {
    separate(mono: Float32Array): Promise<SpeakerSegment[]>;
    name(segments: SpeakerSegment[], mono: Float32Array, participants: Participant[]): Promise<Record<string, string | null>>;
  };
  engine: { start(log: HostLog): Promise<EngineOutcome> };
  makeLog: () => HostLog;
};

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

/** Decode, separate and name if needed, then transcribe the unfinished chunks. Returns the media length. */
async function transcribe(o: Options, file: File, log: HostLog, known: DomainEvent[], saved: RecordingMeta | null): Promise<number> {
  let audio: Awaited<ReturnType<typeof decodeToChannels>> | null = null;
  const decode = async () => {
    if (!audio) { o.onStage({ kind: 'decoding' }); audio = await decodeToChannels(file); }
    return audio;
  };
  let meta = saved && saved.fileSize === file.size && saved.fileName === file.name ? saved : null;
  if (!meta) {
    if (!o.voices) throw new Error('Speaker separation is not available on this page.');
    const start = known.find((e) => e.type === 'session.started');
    if (start?.type !== 'session.started') throw new Error('This session was not found on the server.');
    const participants = start.payload.participants.filter((p) => p.role !== 'audience');
    const { mono, durationMs } = await decode();
    // Chunks saved for another file would be merged into this one's transcript.
    if (saved) await o.checkpoint.clearChunks();
    o.onStage({ kind: 'separating', audioMs: durationMs });
    const segments = await o.voices.separate(mono);
    o.onStage({ kind: 'naming', segments });
    const voiceMap = await o.voices.name(segments, mono, participants);
    meta = { fileName: file.name, fileSize: file.size, durationMs, segments, voiceMap };
    await o.checkpoint.putMeta(meta);
  }

  const plan = planChunks(meta.durationMs);
  const results: { startMs: number; endMs: number; words: Word[] }[] = [];
  o.onStage({ kind: 'transcribing', done: 0, total: plan.length });
  for (const c of plan) {
    let words = await o.checkpoint.getChunk(c.index);
    if (!words) {
      const { mono } = await decode();
      o.onStage({ kind: 'transcribing', done: c.index, total: plan.length });
      words = await o.asr.transcribe(mono.subarray(Math.floor((c.startMs * 16_000) / 1000), Math.floor((c.endMs * 16_000) / 1000)), c.startMs);
      await o.checkpoint.putChunk(c.index, words);
    }
    results.push({ startMs: c.startMs, endMs: c.endMs, words });
    // Re-emitting earlier utterances is harmless: their ids derive from start times and the log drops repeats.
    const stable = settledWords(mergeChunkWords(results), plan[c.index + 1]?.startMs);
    await log.append(buildUtterances({ sessionId: o.sessionId, words: stable, segments: meta.segments, voiceMap: meta.voiceMap, mode: 'diarized', wallTs: new Date().toISOString() }));
    o.onStage({ kind: 'transcribing', done: c.index + 1, total: plan.length });
  }
  await o.checkpoint.putMeta({ ...meta, transcribed: true });
  return meta.durationMs;
}

/** Done only once every event has reached the server; otherwise say how many are waiting. */
async function finish(o: Options, log: HostLog): Promise<void> {
  const pending = await log.close();
  o.onStage(pending === 0 ? { kind: 'done' } : { kind: 'uploading', ...log.status() });
}

export async function runRecording(o: Options): Promise<void> {
  let log: HostLog | null = null;
  try {
    log = o.makeLog();
    await log.hydrate();
    const known = (await log.read(0)).events;
    if (known.some((e) => e.type === 'session.ended')) return await finish(o, log);

    const meta = await o.checkpoint.getMeta();
    const sameFile = Boolean(o.file && meta && meta.fileSize === o.file.size && meta.fileName === o.file.name);
    const spoken = known.flatMap((e) => (e.type === 'utterance.final' ? [e.payload.utterance.endMs] : []));
    let totalMs: number;
    if (meta?.transcribed) totalMs = meta.durationMs;
    else if (!o.file && meta) throw new Error('Choose the recording file to continue.');
    // The transcript is on the server but not this device's progress (cleared storage, another laptop).
    else if (!sameFile && spoken.length > 0) totalMs = Math.max(...spoken);
    else if (!o.file) throw new Error('Choose the recording file to continue.');
    else totalMs = await transcribe(o, o.file, log, known, meta);

    o.onStage({ kind: 'analysing', processedMs: 0, totalMs });
    if ((await o.engine.start(log)) === 'key-rejected') {
      await log.close();
      o.onStage({ kind: 'key-rejected' });
      return;
    }
    await finish(o, log);
  } catch (e) {
    // Unsent events stay in the outbox and go out on the next attempt.
    await log?.close().catch(() => 0);
    o.onStage({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}
