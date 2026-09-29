'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KEY_STORAGE } from '@/lib/anthropic-key';
import { idbCheckpoint, type RecordingMeta } from '@/lib/recording/checkpoint';
import { HOST_SESSIONS_KEY, markHostSession, parseHostSessions, pendingFiles } from '@/lib/recording/host-sessions';
import { useStored } from '@/lib/use-stored';
import type { Stage } from '@/lib/recording/pipeline';
import { startRecording, type NamingRequest } from './start-recording';
import { VoiceNaming } from './VoiceNaming';

const PAUSE_NOTE = 'Processing pauses if you close this tab. You can resume from this page.';
const button = 'min-h-11 rounded border border-border-2 px-4 text-[15px] text-ink hover:bg-field-deep';
const minutes = (ms: number) => Math.round(ms / 60_000);

function stageLine(s: Stage): string {
  switch (s.kind) {
    case 'decoding': return 'Reading the file';
    case 'separating': return 'Separating speakers';
    case 'naming': return 'Name the voices';
    case 'transcribing': return `Transcribing: chunk ${Math.min(s.done + 1, s.total)} of ${s.total}`;
    case 'analysing': return `Analysing: ${minutes(s.processedMs)} of ${minutes(s.totalMs)} minutes`;
    case 'done': return 'Done: open the map';
    case 'error': return 'Processing stopped';
  }
}

function DoneLinks({ id }: { id: string }) {
  const s = encodeURIComponent(id);
  return (
    <div className="flex flex-wrap gap-3">
      <Link className={`${button} inline-flex items-center`} href={`/s/${s}/spatial`}>Open the map</Link>
      <Link className={`${button} inline-flex items-center`} href={`/s/${s}/cockpit`}>Open the cockpit</Link>
    </div>
  );
}

export function Runner({ id }: { id: string }) {
  const key = useStored(KEY_STORAGE);
  const raw = useStored(HOST_SESSIONS_KEY);
  const entry = useMemo(() => parseHostSessions(raw).find((s) => s.id === id) ?? null, [raw, id]);
  const [checked, setChecked] = useState(false);
  const [meta, setMeta] = useState<RecordingMeta | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [naming, setNaming] = useState<NamingRequest | null>(null);
  const [pending, setPending] = useState(0);
  const [spend, setSpend] = useState(0);
  const [unanswered, setUnanswered] = useState(0);
  const [pickError, setPickError] = useState<string | null>(null);
  const running = useRef(false);

  const run = useCallback(async (f: File) => {
    if (running.current) return;
    running.current = true;
    setFile(f);
    setStage({ kind: 'decoding' });
    try {
      await startRecording(id, f, {
        onStage: (s) => {
          setStage(s);
          if (s.kind !== 'naming') setNaming(null);
          if (s.kind === 'done') markHostSession(id, { done: true });
        },
        onModel: setModel,
        onNaming: setNaming,
        onPending: setPending,
        onSpend: (usd) => setSpend((x) => x + usd),
        onUnanswered: () => setUnanswered((n) => n + 1),
      });
    } catch (err) {
      setStage({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      running.current = false;
      setModel(null);
    }
  }, [id]);

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
    void idbCheckpoint(id)
      .then(async (cp) => { const m = await cp.getMeta(); cp.close(); if (live) setMeta(m); })
      .catch(() => { /* no saved progress on this device */ })
      .finally(() => { if (live) setChecked(true); });
    return () => { live = false; };
  }, [key, id, run]);

  const active = stage !== null && stage.kind !== 'done' && stage.kind !== 'error';
  useEffect(() => {
    if (!active) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = PAUSE_NOTE; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (meta && (meta.fileName !== f.name || meta.fileSize !== f.size)) return setPickError(`That is a different file. This session was started with ${meta.fileName}.`);
    setPickError(null);
    void run(f);
  };

  if (!key || (!stage && !checked)) return null;
  return (
    <div>
      <h1 className="text-[30px] leading-tight text-ink">{entry?.title ?? 'Processing a recording'}</h1>
      <div className="mt-8 space-y-6">
        {stage ? (
          <p className="text-[20px] text-ink" aria-live="polite">{stageLine(stage)}</p>
        ) : entry?.done ? (
          <p className="text-[20px] text-ink">Done: open the map</p>
        ) : (
          <div>
            <label htmlFor="file" className="block text-[15px] text-ink-2">{meta ? 'Choose the same file again to resume.' : 'Choose the recording file to start.'}</label>
            <input id="file" type="file" accept="audio/*,video/*" className="mt-3 block text-[15px] text-ink" onChange={(e) => pick(e.target.files?.[0])} />
            {pickError && <p role="alert" className="mt-2 text-sm text-ink">{pickError}</p>}
          </div>
        )}

        {model && <p className="text-[15px] text-ink-2">{model}</p>}
        {stage?.kind === 'naming' && naming && <VoiceNaming request={naming} />}
        {stage?.kind === 'error' && (
          <div className="space-y-3">
            <p role="alert" className="text-[15px] text-ink">{stage.message}</p>
            {file && <button type="button" className={button} onClick={() => void run(file)}>Try again</button>}
          </div>
        )}
        {(stage?.kind === 'done' || (!stage && entry?.done)) && <DoneLinks id={id} />}

        {unanswered > 0 && <p className="text-[15px] text-ink-2">{unanswered} analysis {unanswered === 1 ? 'request' : 'requests'} did not get an answer; those turns stay off the map.</p>}
        {pending > 0 && <p className="text-[15px] text-ink-2">{pending} {pending === 1 ? 'event' : 'events'} waiting to upload</p>}
        {spend > 0 && <p className="text-sm text-ink-3">Estimated spend: ${spend.toFixed(2)}</p>}
        {active && <p className="text-sm text-ink-3">{PAUSE_NOTE} Nothing that has finished is lost.</p>}
      </div>
    </div>
  );
}
