/**
 * Wires the in-tab pieces for one recording: the host's key, the transcription and
 * speaker-separation workers, the event log with its device outbox, and the engine.
 */
import { HttpEventLog, SessionEngine, type UploadStatus } from '@adl/engine';
import { browserCaller, setCaller } from '@adl/llm/browser';
import { getKey } from '@/lib/anthropic-key';
import { AsrClient } from '@/lib/asr/client';
import { DiarizeClient } from '@/lib/diarize/client';
import { idbCheckpoint } from '@/lib/recording/checkpoint';
import { runRecording, type Participant, type ReviewAnswer, type ReviewLine, type Stage } from '@/lib/recording/pipeline';
import { keyRejected, unansweredRequest } from '@/lib/recording/unanswered';
import type { SpeakerSegment } from '@/lib/diarize/client';

export type NamingRequest = { segments: SpeakerSegment[]; mono: Float32Array; participants: Participant[]; resolve: (voiceMap: Record<string, string | null>) => void };

export type ReviewRequest = { lines: ReviewLine[]; mono: Float32Array | null; participants: Participant[]; resolve: (answers: ReviewAnswer[]) => void };

export type RunCallbacks = {
  onStage: (s: Stage) => void;
  onModel: (line: string | null) => void;
  onNaming: (r: NamingRequest) => void;
  onReview: (r: ReviewRequest) => void;
  onUpload: (s: UploadStatus) => void;
  onSpend: (usd: number) => void;
  onUnanswered: () => void;
};

export async function sessionToken(sessionId: string): Promise<string> {
  const res = await fetch('/api/host/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId }) });
  const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
  if (!res.ok || !body.token) throw new Error(body.error ?? `Could not open this session (${res.status})`);
  return body.token;
}

/** Put a finished host session on the public list, or take it off (session.published). */
export async function setPublished(sessionId: string, published: boolean): Promise<void> {
  const token = await sessionToken(sessionId);
  const event = { eventId: `${sessionId}:published:${Date.now()}`, sessionId, type: 'session.published', actor: 'operator', mediaMs: 0, wallTs: new Date().toISOString(), payload: { published } };
  const res = await fetch('/api/events', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ events: [event] }) });
  if (!res.ok) throw new Error(`Not saved: the server returned ${res.status}`);
}

/** Deliver what this device still holds for the session (no file, no analysis). */
export async function uploadOutbox(sessionId: string): Promise<UploadStatus> {
  const cp = await idbCheckpoint(sessionId);
  try {
    const log = new HttpEventLog({ sessionId, token: () => sessionToken(sessionId), outbox: cp.outbox });
    await log.loadOutbox();
    await log.close(); // one delivery attempt; an empty outbox sends nothing
    return log.status();
  } finally {
    cp.close();
  }
}

/** `file` is null when only the analysis is left (the transcript is already in the log). */
export async function startRecording(sessionId: string, file: File | null, cb: RunCallbacks): Promise<void> {
  const key = getKey();
  if (!key) throw new Error('Add your Anthropic key first.');
  setCaller(browserCaller(key));
  const cp = await idbCheckpoint(sessionId);
  let asr: Promise<AsrClient> | null = null;
  const loadAsr = () =>
    (asr ??= (async () => {
      cb.onModel('Loading the transcription model.');
      const c = await AsrClient.load((p) => cb.onModel(`Downloading the transcription model: file ${p.fileNumber}, ${Math.round(p.bytes / 1_000_000)} MB so far.`));
      cb.onModel(null);
      return c;
    })());
  let totalMs = 0;
  try {
    await runRecording({
      sessionId,
      file,
      asr: { transcribe: async (pcm, offsetMs) => (await loadAsr()).transcribe(pcm, offsetMs) },
      checkpoint: cp,
      onStage: (s) => {
        if (s.kind === 'analysing') totalMs = s.totalMs;
        cb.onStage(s);
      },
      voices: {
        separate: async (mono) => {
          const d = await DiarizeClient.load();
          try { return await d.diarize(mono); } finally { d.terminate(); }
        },
        name: (segments, mono, participants) => new Promise((resolve) => cb.onNaming({ segments, mono, participants, resolve })),
      },
      review: (lines, mono, participants) => new Promise((resolve) => cb.onReview({ lines, mono, participants, resolve })),
      engine: {
        start: async (log) => {
          let rejected = false;
          const engine = new SessionEngine({
            sessionId,
            log,
            silenceMs: 0,
            onCall: (l) => cb.onSpend(l.billedUsd),
            onProgress: (p) => cb.onStage({ kind: 'analysing', processedMs: p.processedMediaMs, totalMs }),
            say: (line) => {
              // A refused key fails every later request too: stop at the first one.
              if (keyRejected(line)) { rejected = true; engine.stop(); }
              else if (unansweredRequest(line)) cb.onUnanswered();
            },
          });
          engine.finishSource();
          await engine.run();
          return rejected ? 'key-rejected' : 'finished';
        },
      },
      makeLog: () => {
        const log = new HttpEventLog({ sessionId, token: () => sessionToken(sessionId), outbox: cp.outbox });
        log.onStatus = cb.onUpload;
        return log;
      },
    });
  } finally {
    if (asr) void (asr as Promise<AsrClient>).then((c) => c.terminate(), () => {});
    cp.close();
  }
}
