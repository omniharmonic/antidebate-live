/**
 * Wires the in-tab pieces for one recording: the host's key, the transcription and
 * speaker-separation workers, the event log with its device outbox, and the engine.
 */
import { HttpEventLog, SessionEngine } from '@adl/engine';
import { browserCaller, setCaller } from '@adl/llm/browser';
import { getKey } from '@/lib/anthropic-key';
import { AsrClient } from '@/lib/asr/client';
import { DiarizeClient } from '@/lib/diarize/client';
import { idbCheckpoint } from '@/lib/recording/checkpoint';
import { runRecording, type Participant, type Stage } from '@/lib/recording/pipeline';
import { unansweredRequest } from '@/lib/recording/unanswered';
import type { SpeakerSegment } from '@/lib/diarize/client';

export type NamingRequest = { segments: SpeakerSegment[]; mono: Float32Array; participants: Participant[]; resolve: (voiceMap: Record<string, string | null>) => void };

export type RunCallbacks = {
  onStage: (s: Stage) => void;
  onModel: (line: string | null) => void;
  onNaming: (r: NamingRequest) => void;
  onPending: (n: number) => void;
  onSpend: (usd: number) => void;
  onUnanswered: () => void;
};

async function sessionToken(sessionId: string): Promise<string> {
  const res = await fetch('/api/host/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId }) });
  const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
  if (!res.ok || !body.token) throw new Error(body.error ?? `Could not open this session (${res.status})`);
  return body.token;
}

export async function startRecording(sessionId: string, file: File, cb: RunCallbacks): Promise<void> {
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
        separate: async (mono, n) => {
          const d = await DiarizeClient.load();
          try { return await d.diarize(mono, n); } finally { d.terminate(); }
        },
        name: (segments, mono, participants) => new Promise((resolve) => cb.onNaming({ segments, mono, participants, resolve })),
      },
      engine: {
        start: (log) => {
          const engine = new SessionEngine({
            sessionId,
            log,
            silenceMs: 0,
            onCall: (l) => cb.onSpend(l.billedUsd),
            onProgress: (p) => cb.onStage({ kind: 'analysing', processedMs: p.processedMediaMs, totalMs }),
            say: (line) => { if (unansweredRequest(line)) cb.onUnanswered(); },
          });
          engine.finishSource();
          return engine.run();
        },
      },
      makeLog: () => {
        const log = new HttpEventLog({ sessionId, token: () => sessionToken(sessionId), outbox: cp.outbox });
        log.onStatus = (s) => cb.onPending(s.pending);
        return log;
      },
    });
  } finally {
    if (asr) void (asr as Promise<AsrClient>).then((c) => c.terminate(), () => {});
    cp.close();
  }
}
