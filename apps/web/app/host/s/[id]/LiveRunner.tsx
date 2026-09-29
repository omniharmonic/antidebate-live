'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UploadStatus } from '@adl/engine';
import type { ChannelMap } from '@/lib/attribution/attributor';
import { KEY_STORAGE } from '@/lib/anthropic-key';
import { idbAnchorsStore } from '@/lib/live/anchors-store';
import { pendingLive } from '@/lib/live/handoff';
import { latencyWarning, listenChannels, liveControls, pendingFromLog, type LivePhase, statusLine, transcriptLines, type PendingLine } from '@/lib/live/live-view';
import type { LiveStatus } from '@/lib/live/runner';
import { markHostSession } from '@/lib/recording/host-sessions';
import { useStored } from '@/lib/use-stored';
import { Failed, Notices, Transcript } from './LiveParts';
import { button, DoneLinks, KeyRejected, Publish } from './RunnerParts';
import { openLiveSession, type LiveSession } from './start-live';
import { Unconfirmed } from './Unconfirmed';
import { useLiveCapture } from './use-live-capture';
import { useProcessingGuards } from './use-processing-guards';


/** The live host view: status, notices, lines to confirm, the transcript, Pause and End. */
export function LiveRunner({ id, title }: { id: string; title: string }) {
  const key = useStored(KEY_STORAGE);
  const [session, setSession] = useState<LiveSession | null>(null);
  const [phase, setPhase] = useState<LivePhase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [upload, setUpload] = useState<UploadStatus>({ pending: 0, lastError: null });
  const [model, setModel] = useState<string | null>(null);
  const [spend, setSpend] = useState(0);
  const [unanswered, setUnanswered] = useState(0);
  const [rejected, setRejected] = useState(false);
  const [restored, setRestored] = useState<PendingLine[]>([]);
  const [lines, setLines] = useState<{ id: string; speaker: string; text: string }[]>([]);
  const [channels, setChannels] = useState<ChannelMap>({});
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const capture = useLiveCapture(session, setError);
  const { begin } = capture;
  const opening = useRef<Promise<LiveSession> | null>(null);
  const disposing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handoffStreams = useRef<MediaStream[] | null>(null);
  const endCapture = useRef(capture.end);
  useEffect(() => { endCapture.current = capture.end; }, [capture.end]);

  const people = useMemo(() => session?.state?.setup.participants ?? [], [session]);
  const names = useMemo(() => Object.fromEntries(people.map((p) => [p.key, p.displayName])), [people]);

  useEffect(() => {
    if (key === null) window.location.replace(`/host/key?next=${encodeURIComponent(`/host/s/${id}`)}`);
  }, [key, id]);

  useEffect(() => {
    if (!key) return;
    // React's development double mount must not tear the session down: disposal waits a tick and a remount cancels it.
    if (disposing.current) { clearTimeout(disposing.current); disposing.current = null; }
    if (!opening.current) {
      const handoff = pendingLive.get(id);
      pendingLive.delete(id);
      handoffStreams.current = handoff?.streams ?? null;
      opening.current = openLiveSession(id, handoff, {
        onStatus: setStatus, onUpload: setUpload, onModel: setModel,
        onSpend: (usd) => setSpend((x) => x + usd), onUnanswered: () => setUnanswered((n) => n + 1), onKeyRejected: () => setRejected(true),
      });
      opening.current.then(async (s) => {
        setSession(s);
        setChannels(s.state?.setup.channels ?? {});
        setRestored(pendingFromLog(await s.events()));
        setPhase(s.ended ? 'ended' : s.runner ? 'live' : 'elsewhere');
      }, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    }
    return () => {
      disposing.current = setTimeout(() => {
        endCapture.current();
        void opening.current?.then((s) => s.dispose(), () => {});
        opening.current = null;
      }, 0);
    };
  }, [key, id]);

  // Streams handed over from the setup screens start at once; after a reload the host clicks.
  useEffect(() => {
    if (phase !== 'live' || !handoffStreams.current) return;
    const s = handoffStreams.current;
    handoffStreams.current = null;
    void begin(s);
  }, [phase, begin]);

  useEffect(() => {
    if (!session) return;
    let live = true;
    void session.events().then((ev) => { if (live) setLines(transcriptLines(ev, names, 8)); });
    return () => { live = false; };
  }, [session, status, names]);

  const hidden = useProcessingGuards(phase === 'live' || phase === 'ending' || phase === 'ending-failed');

  const confirm = useCallback(async (ids: string[], participantKey: string) => {
    for (const u of ids) await session?.runner?.confirm(u, participantKey);
    setRestored((r) => r.filter((l) => !ids.includes(l.utteranceId)));
  }, [session]);

  const swap = async (a: string, b: string) => {
    session?.runner?.applySwap(a, b);
    const next = { ...channels, [a]: channels[b]!, [b]: channels[a]! };
    setChannels(next);
    const st = session?.state;
    if (!st) return;
    const store = await idbAnchorsStore(id);
    try { await store.save({ ...st, setup: { ...st.setup, channels: next } }); } finally { store.close(); }
  };

  /** End (or try again): capture never restarts once End has begun, since the runner is stopped. */
  const end = async () => {
    if (!session) return;
    setPhase('ending');
    setError(null);
    capture.end();
    try {
      await session.finish();
      markHostSession(id, { done: true });
      setPhase('ended');
    } catch (e) {
      setError(`The session did not finish ending: ${e instanceof Error ? e.message : String(e)}`);
      setPhase('ending-failed');
    }
  };
  const controls = liveControls(phase, capture.state);

  if (!key) return null;
  const setup = session?.state?.setup;
  const pending = [...(status?.unconfirmed ?? []), ...restored.filter((r) => !status?.unconfirmed.some((u) => u.utteranceId === r.utteranceId))];
  return (
    <div>
      <h1 className="text-[30px] leading-tight text-ink">{title}</h1>
      <div className="mt-8 space-y-6">
        {phase === 'loading' && !error && <p className="text-[20px] text-ink">Opening the session</p>}
        {phase === 'elsewhere' && <p className="text-[20px] text-ink">This session was set up on another laptop. Open it there to keep listening.</p>}
        {phase === 'ending' && <p className="text-[20px] text-ink" aria-live="polite">Ending…</p>}
        {phase === 'ending-failed' && <p className="text-[20px] text-ink">Capture has stopped; the session has not finished ending.</p>}
        {phase === 'ended' && <p className="text-[20px] text-ink">Session ended. Open the map.</p>}
        {phase === 'live' && setup && (
          <div className="space-y-3">
            {capture.state === 'on' && <p className="text-[20px] text-ink" aria-live="polite">{statusLine(listenChannels(setup).length, status?.lastLatencyMs ?? null)}</p>}
            {controls.includes('resume-listening') && <button type="button" className={button} onClick={() => void capture.reopen()}>Click to resume listening</button>}
            {capture.state === 'paused' && <p className="text-[20px] text-ink">Paused</p>}
            {controls.includes('resume-audio') && (
              <div className="space-y-3">
                <p className="text-[20px] text-ink" role="alert">Audio stopped</p>
                <button type="button" className={button} onClick={() => void capture.reopen()}>Resume audio</button>
              </div>
            )}
          </div>
        )}
        {phase === 'live' && capture.state === 'on' && status && latencyWarning(status.recentLatencyMs) && <p role="status" className="text-[15px] text-ink">{latencyWarning(status.recentLatencyMs)}</p>}
        {model && <p className="text-[15px] text-ink-2">{model}</p>}
        {error && <p role="alert" className="text-[15px] text-ink">{error}</p>}
        {hidden && phase === 'live' && <p role="status" className="text-[15px] text-ink">This tab is in the background. Keep it in front so capture isn&apos;t slowed.</p>}
        {rejected && <KeyRejected id={id} />}
        {unanswered > 0 && <p className="text-[15px] text-ink-2">Analysis delayed: {unanswered} {unanswered === 1 ? 'request' : 'requests'} did not get an answer; those turns stay off the map.</p>}

        {phase === 'live' && status && <Notices status={status} channels={channels} names={names} dismissed={dismissed} onDismiss={(i) => setDismissed((d) => new Set(d).add(i))} onSwap={(a, b) => void swap(a, b)} />}
        {phase === 'live' && status && <Failed items={status.failed} onRetry={(c, ms) => void session?.runner?.retryAt(c, ms)} />}
        {phase === 'live' && <Unconfirmed lines={pending} voices={status?.newVoices ?? []} people={people} clip={capture.clip} onConfirm={confirm} />}
        <Transcript lines={lines} />

        {controls.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {controls.includes('pause') && <button type="button" className={button} onClick={capture.pause}>Pause</button>}
            {controls.includes('resume') && <button type="button" className={button} onClick={capture.resume}>Resume</button>}
            {controls.includes('end') && <button type="button" className={button} onClick={() => void end()}>End session</button>}
            {controls.includes('try-end-again') && <button type="button" className={button} onClick={() => void end()}>Try ending again</button>}
          </div>
        )}
        {upload.pending > 0 && <p className="text-[15px] text-ink-2">{upload.pending} {upload.pending === 1 ? 'event' : 'events'} waiting to upload{upload.lastError ? `: ${upload.lastError}` : ''}</p>}
        {spend > 0 && <p className="text-sm text-ink-3">Estimated spend: ${spend.toFixed(2)}</p>}
        {phase !== 'loading' && <DoneLinks id={id} newTab={phase !== 'ended'} />}
        {phase === 'ended' && <Publish id={id} />}
      </div>
    </div>
  );
}
