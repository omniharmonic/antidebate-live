/**
 * Wires the in-tab pieces for one live session: the host's key, the event log (hydrated from the
 * server, with this device's outbox), the stored setup and voices, the transcription and voice
 * models, the live runner, and the engine, which runs until the host ends the session.
 */
import type { DomainEvent } from '@adl/core';
import { HttpEventLog, SessionEngine, type UploadStatus } from '@adl/engine';
import { browserCaller, setCaller } from '@adl/llm/browser';
import { getKey } from '@/lib/anthropic-key';
import { AsrClient } from '@/lib/asr/client';
import { DiarizeClient } from '@/lib/diarize/client';
import { idbAnchorsStore, type LiveState } from '@/lib/live/anchors-store';
import { finisher } from '@/lib/live/finisher';
import type { LiveHandoff } from '@/lib/live/handoff';
import { LiveRunner, type LiveStatus } from '@/lib/live/runner';
import { idbCheckpoint } from '@/lib/recording/checkpoint';
import { keyRejected, unansweredRequest } from '@/lib/recording/unanswered';
import { sessionToken } from './start-recording';

export type LiveCallbacks = {
  onStatus: (s: LiveStatus) => void;
  onUpload: (s: UploadStatus) => void;
  onModel: (line: string | null) => void;
  onSpend: (usd: number) => void;
  onUnanswered: () => void;
  onKeyRejected: () => void;
};

export type LiveSession = {
  /** Setup, voices and capture spec from this device; null when the session was set up elsewhere. */
  state: LiveState | null;
  ended: boolean;
  runner: LiveRunner | null;
  events: () => Promise<DomainEvent[]>;
  /**
   * Drain the runner, let the engine finish (final cards, session.ended), deliver the outbox. After a
   * failure, calling it again re-runs only the delivery: the runner and engine are already finished.
   */
  finish: () => Promise<void>;
  /** Stop everything without ending the session (page left or reloaded). */
  dispose: () => void;
};

const noVoices = { matchVoices: () => Promise.reject(new Error('Speaker separation did not load.')) };

export async function openLiveSession(sessionId: string, handoff: LiveHandoff | undefined, cb: LiveCallbacks): Promise<LiveSession> {
  const key = getKey();
  if (!key) throw new Error('Add your Anthropic key first.');
  setCaller(browserCaller(key));
  const cp = await idbCheckpoint(sessionId);
  const log = new HttpEventLog({ sessionId, token: () => sessionToken(sessionId), outbox: cp.outbox });
  log.onStatus = cb.onUpload;
  const events = async () => (await log.read(0)).events;
  let state: LiveState | null = null;
  try {
    await log.hydrate();
    const store = await idbAnchorsStore(sessionId);
    try { state = await store.load(); } finally { store.close(); }
  } catch (e) {
    cp.close();
    throw e;
  }
  const ended = (await events()).some((e) => e.type === 'session.ended');
  if (ended || !state) {
    handoff?.asr?.terminate();
    handoff?.voices?.terminate();
    return { state, ended, runner: null, events, finish: async () => {}, dispose: () => { void log.close(); cp.close(); } };
  }

  let asr = handoff?.asr;
  let voices = handoff?.voices;
  try {
    if (!asr) {
      cb.onModel('Loading the transcription model.');
      asr = await AsrClient.load((p) => cb.onModel(`Downloading the transcription model: file ${p.fileNumber}, ${Math.round(p.bytes / 1_000_000)} MB so far.`));
    }
    voices ??= await DiarizeClient.load().catch(() => undefined);
  } catch (e) {
    voices?.terminate();
    cp.close();
    throw e;
  } finally {
    cb.onModel(null);
  }

  const runner = new LiveRunner({ sessionId, setup: state.setup, anchors: state.anchors, asr, voices: voices ?? noVoices, log, onStatus: cb.onStatus });
  const engine: SessionEngine = new SessionEngine({
    sessionId,
    log,
    silenceMs: 3500,
    onCall: (l) => cb.onSpend(l.billedUsd),
    say: (line) => {
      // A refused key fails every later request too: stop the analysis; the transcript keeps going.
      if (keyRejected(line)) { engine.stop(); cb.onKeyRejected(); }
      else if (unansweredRequest(line)) cb.onUnanswered();
    },
  });
  const running = engine.run();
  const release = () => { asr.terminate(); voices?.terminate(); cp.close(); };

  return {
    state,
    ended: false,
    runner,
    events,
    finish: finisher(
      async () => {
        await runner.stop();
        engine.finishSource();
        await running;
      },
      async () => {
        // The engine writes session.ended when it finishes; stopped by a refused key it cannot, so End writes it
        // (same id, so it is never doubled).
        const all = await events();
        if (!all.some((e) => e.type === 'session.ended')) {
          const mediaMs = all.reduce((m, e) => Math.max(m, e.mediaMs), 0);
          await log.append([{ eventId: `${sessionId}:end`, sessionId, type: 'session.ended', actor: 'system', mediaMs, wallTs: new Date().toISOString(), payload: {} } as DomainEvent]);
        }
        const waiting = await log.close();
        if (waiting > 0) throw new Error(`${waiting} ${waiting === 1 ? 'event is' : 'events are'} still waiting to upload. Check the connection and try again.`);
        release();
      },
    ),
    dispose: () => {
      engine.stop();
      void runner.stop().then(() => running).then(() => log.close()).finally(release);
    },
  };
}

/** The session's title and source kind from its session.started event (for a session this browser did not start). */
export async function sessionSource(sessionId: string): Promise<{ title: string; kind: 'live' | 'recording' } | null> {
  const token = await sessionToken(sessionId);
  const res = await fetch(`/api/events?sessionId=${encodeURIComponent(sessionId)}&after=0`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const { events } = (await res.json()) as { events: DomainEvent[] };
  const started = events.find((e) => e.type === 'session.started');
  if (started?.type !== 'session.started') return null;
  return { title: started.payload.title, kind: started.payload.source?.kind === 'live' ? 'live' : 'recording' };
}
