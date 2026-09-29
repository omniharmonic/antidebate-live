'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UploadStatus } from '@adl/engine';
import { KEY_STORAGE } from '@/lib/anthropic-key';
import { idbCheckpoint, type RecordingMeta } from '@/lib/recording/checkpoint';
import { HOST_SESSIONS_KEY, hostSessions, markHostSession, parseHostSessions, pendingFiles } from '@/lib/recording/host-sessions';
import { useStored } from '@/lib/use-stored';
import type { Stage } from '@/lib/recording/pipeline';
import { button, DoneLinks, KeyRejected, Publish, UploadWaiting } from './RunnerParts';
import { startRecording, uploadOutbox, type NamingRequest } from './start-recording';
import { PAUSE_NOTE, useProcessingGuards } from './use-processing-guards';
import { VoiceNaming } from './VoiceNaming';

const minutes = (ms: number) => Math.round(ms / 60_000);
const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`;

function stageLine(s: Stage, elapsedMs: number): string {
  switch (s.kind) {
    case 'decoding': return 'Reading the file';
    case 'separating': return `Separating speakers: ${clock(elapsedMs)} so far. Usually takes about a quarter of the recording's length.`;
    case 'naming': return 'Name the voices';
    case 'transcribing': return `Transcribing: chunk ${Math.min(s.done + 1, s.total)} of ${s.total}`;
    case 'analysing': return `Analysing: ${minutes(s.processedMs)} of ${minutes(s.totalMs)} minutes`;
    case 'uploading': return 'Finished on this laptop; uploading';
    case 'key-rejected': return 'Analysis paused';
    case 'done': return 'Done: open the map';
    case 'error': return 'Processing stopped';
  }
}

export function Runner({ id }: { id: string }) {
  const key = useStored(KEY_STORAGE);
  const raw = useStored(HOST_SESSIONS_KEY);
  const entry = useMemo(() => parseHostSessions(raw).find((s) => s.id === id) ?? null, [raw, id]);
  const [checked, setChecked] = useState(false);
  const [meta, setMeta] = useState<RecordingMeta | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [stageAt, setStageAt] = useState(0);
  const [now, setNow] = useState(0);
  const [model, setModel] = useState<string | null>(null);
  const [naming, setNaming] = useState<NamingRequest | null>(null);
  const [upload, setUpload] = useState<UploadStatus>({ pending: 0, lastError: null });
  const [uploading, setUploading] = useState(false);
  const [spend, setSpend] = useState(0);
  const [unanswered, setUnanswered] = useState(0);
  const [pickError, setPickError] = useState<string | null>(null);
  const running = useRef(false);
  const shownKind = useRef<Stage['kind'] | null>(null);

  const show = useCallback((s: Stage) => {
    if (shownKind.current !== s.kind) { shownKind.current = s.kind; setStageAt(Date.now()); }
    setStage(s);
    if (s.kind !== 'naming') setNaming(null);
    if (s.kind === 'uploading') setUpload({ pending: s.pending, lastError: s.lastError });
    if (s.kind === 'done') { setUpload({ pending: 0, lastError: null }); markHostSession(id, { done: true }); }
  }, [id]);

  /** `f` null: only the analysis is left (the transcript is in the log). */
  const run = useCallback(async (f: File | null) => {
    if (running.current) return;
    running.current = true;
    if (f) setFile(f);
    try {
      await startRecording(id, f, { onStage: show, onModel: setModel, onNaming: setNaming, onUpload: setUpload, onSpend: (usd) => setSpend((x) => x + usd), onUnanswered: () => setUnanswered((n) => n + 1) });
    } catch (err) {
      show({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      running.current = false;
      setModel(null);
    }
  }, [id, show]);

  const retryUpload = async () => {
    setUploading(true);
    try {
      const s = await uploadOutbox(id);
      setUpload(s);
      if (s.pending === 0 && stage?.kind === 'uploading') show({ kind: 'done' });
    } catch (err) {
      setUpload((u) => ({ ...u, lastError: err instanceof Error ? err.message : String(err) }));
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    if (key === null) window.location.replace(`/host/key?next=${encodeURIComponent(`/host/s/${id}`)}`);
  }, [key, id]);

  useEffect(() => {
    if (!key) return;
    const handed = pendingFiles.get(id);
    if (handed) {
      pendingFiles.delete(id);
      void Promise.resolve(handed).then(run); // start after this effect, not inside it
      return;
    }
    let live = true;
    void (async () => {
      let m: RecordingMeta | null = null;
      try { const cp = await idbCheckpoint(id); m = await cp.getMeta(); cp.close(); } catch { /* no saved progress on this device */ }
      if (!live) return;
      setMeta(m);
      // Transcribed here but not finished (closed tab, rejected key): the analysis resumes without the file.
      if (m?.transcribed && !hostSessions().find((s) => s.id === id)?.done) {
        setChecked(true);
        return void run(null);
      }
      // Anything this laptop still holds goes up now, whether or not the file is chosen again.
      try { const s = await uploadOutbox(id); if (live) setUpload(s); } catch { /* storage unavailable */ }
      if (live) setChecked(true);
    })();
    return () => { live = false; };
  }, [key, id, run]);

  const active = stage !== null && !['done', 'error', 'uploading', 'key-rejected'].includes(stage.kind);
  const hidden = useProcessingGuards(active);

  useEffect(() => {
    if (stage?.kind !== 'separating') return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [stage?.kind]);

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (meta && (meta.fileName !== f.name || meta.fileSize !== f.size)) return setPickError(`That is a different file. This session was started with ${meta.fileName}.`);
    setPickError(null);
    void run(f);
  };

  const waiting = upload.pending > 0 && (!stage || stage.kind === 'uploading' || stage.kind === 'done');
  const done = stage?.kind === 'done' || (!stage && entry?.done && !waiting);
  if (!key || (!stage && !checked)) return null;
  return (
    <div>
      <h1 className="text-[30px] leading-tight text-ink">{entry?.title ?? 'Processing a recording'}</h1>
      <div className="mt-8 space-y-6">
        {stage ? (
          <p className="text-[20px] text-ink" aria-live="polite">{stageLine(stage, Math.max(0, now - stageAt))}</p>
        ) : done ? (
          <p className="text-[20px] text-ink">Done: open the map</p>
        ) : waiting && entry?.done ? null : (
          <div>
            <label htmlFor="file" className="block text-[15px] text-ink-2">{meta ? 'Choose the same file again to resume.' : 'Choose the recording file to start.'}</label>
            <input id="file" type="file" accept="audio/*,video/*" className="mt-3 block text-[15px] text-ink" onChange={(e) => pick(e.target.files?.[0])} />
            {pickError && <p role="alert" className="mt-2 text-sm text-ink">{pickError}</p>}
          </div>
        )}

        {hidden && active && <p role="status" className="text-[15px] text-ink">This tab is in the background. Keep it in front so processing isn&apos;t slowed.</p>}
        {model && <p className="text-[15px] text-ink-2">{model}</p>}
        {stage?.kind === 'naming' && naming && <VoiceNaming request={naming} />}
        {stage?.kind === 'key-rejected' && <KeyRejected id={id} />}
        {stage?.kind === 'error' && (
          <div className="space-y-3">
            <p role="alert" className="text-[15px] text-ink">{stage.message}</p>
            {(file || meta?.transcribed) && <button type="button" className={button} onClick={() => void run(file)}>Try again</button>}
          </div>
        )}
        {waiting && <UploadWaiting status={upload} busy={uploading} onRetry={() => void retryUpload()} />}
        {done && <DoneLinks id={id} />}
        {done && <Publish id={id} />}

        {unanswered > 0 && <p className="text-[15px] text-ink-2">{unanswered} analysis {unanswered === 1 ? 'request' : 'requests'} did not get an answer; those turns stay off the map.</p>}
        {active && upload.pending > 0 && <p className="text-[15px] text-ink-2">{upload.pending} {upload.pending === 1 ? 'event' : 'events'} waiting to upload{upload.lastError ? `: ${upload.lastError}` : ''}</p>}
        {spend > 0 && <p className="text-sm text-ink-3">Estimated spend: ${spend.toFixed(2)}</p>}
        {active && <p className="text-sm text-ink-3">{PAUSE_NOTE} Nothing that has finished is lost.</p>}
      </div>
    </div>
  );
}
