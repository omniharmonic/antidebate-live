'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AsrClient, readiness } from '@/lib/asr/client';
import { DiarizeClient } from '@/lib/diarize/client';

type Status = 'ready' | 'attention' | 'progress' | 'waiting';
type ModelState = { kind: 'idle' } | { kind: 'loading'; fileNumber: number; bytes: number } | { kind: 'ready' } | { kind: 'error' };
type SpeedState = { kind: 'idle' } | { kind: 'running' } | { kind: 'done'; factor: number } | { kind: 'error' };

const LABEL: Record<Status, string> = { ready: 'Ready', attention: 'Needs attention', progress: 'In progress', waiting: 'Waiting' };

function Row({ n, title, status, children }: { n: number; title: string; status: Status; children: React.ReactNode }) {
  return (
    <li className="border-t border-border py-5 first:border-t-0">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-[17px] text-ink">{n}. {title}</h2>
        <span className="label-caps">{LABEL[status]}</span>
      </div>
      <div className="mt-2 space-y-3 text-[15px] text-ink-2">{children}</div>
    </li>
  );
}

const button = 'min-h-11 rounded border border-border-2 px-4 text-[15px] text-ink hover:bg-field-deep disabled:opacity-50';

type SeparationState = { kind: 'idle' } | { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; message: string };

/** Row 4 of the checklist: the speaker-separation bundle (about 58 MB, cached by the browser after the first load). */
function SpeakerSeparationRow({ n, state, onLoad, disabled }: { n: number; state: SeparationState; onLoad: () => void; disabled: boolean }) {
  const status: Status = state.kind === 'ready' ? 'ready' : state.kind === 'loading' ? 'progress' : state.kind === 'error' ? 'attention' : 'waiting';
  return (
    <Row n={n} title="Speaker separation" status={status}>
      {state.kind === 'ready' && <p>Speaker separation is loaded. Single-file recordings are split by voice on this laptop.</p>}
      {state.kind === 'idle' && <p>Splits a single-file recording into voices so you can name each one. It runs inside this browser.</p>}
      {state.kind === 'loading' && <p>Loading speaker separation (about 58 MB). This can take a minute.</p>}
      {state.kind === 'error' && <p role="alert">{state.message}</p>}
      {(state.kind === 'idle' || state.kind === 'error') && (
        <button className={button} disabled={disabled} onClick={onLoad}>{state.kind === 'error' ? 'Try again' : 'Load speaker separation'}</button>
      )}
    </Row>
  );
}

export function Prepare() {
  const [browserOk, setBrowserOk] = useState<boolean | null>(null);
  const [model, setModel] = useState<ModelState>({ kind: 'idle' });
  const [speed, setSpeed] = useState<SpeedState>({ kind: 'idle' });
  const [separation, setSeparation] = useState<SeparationState>({ kind: 'idle' });
  const client = useRef<AsrClient | null>(null);
  const diarizer = useRef<DiarizeClient | null>(null);
  const separating = useRef(false);
  const loading = useRef(false);
  const alive = useRef(false);
  const [preparedOn, setPreparedOn] = useState<string | null>(null);

  const loadModel = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    setModel({ kind: 'loading', fileNumber: 0, bytes: 0 });
    try {
      await navigator.storage?.persist?.();
      const c = await AsrClient.load((p) => { if (alive.current) setModel({ kind: 'loading', fileNumber: p.fileNumber, bytes: p.bytes }); });
      if (!alive.current) { c.terminate(); return; }
      client.current?.terminate();
      client.current = c;
      setModel({ kind: 'ready' });
    } catch {
      if (alive.current) setModel({ kind: 'error' });
    } finally {
      loading.current = false;
    }
  }, []);

  useEffect(() => {
    let live = true;
    alive.current = true;
    try { setPreparedOn(localStorage.getItem('adl.prepared')); } catch { /* storage blocked */ }
    void readiness().then((r) => {
      if (!live) return;
      setBrowserOk(r.browserOk);
      // Files already stored on this laptop load without a download.
      if (r.browserOk && r.modelCached) void loadModel();
    });
    return () => { live = false; alive.current = false; client.current?.terminate(); client.current = null; diarizer.current?.terminate(); diarizer.current = null; };
  }, [loadModel]);

  const loadSeparation = useCallback(async () => {
    if (separating.current) return;
    separating.current = true;
    setSeparation({ kind: 'loading' });
    try {
      const d = await DiarizeClient.load();
      if (!alive.current) { d.terminate(); return; }
      diarizer.current?.terminate();
      diarizer.current = d;
      setSeparation({ kind: 'ready' });
    } catch (err) {
      if (alive.current) setSeparation({ kind: 'error', message: err instanceof Error ? err.message : 'Speaker separation did not load.' });
    } finally {
      separating.current = false;
    }
  }, []);

  const runSpeed = async () => {
    if (!client.current) return;
    setSpeed({ kind: 'running' });
    try {
      const { realtimeFactor } = await client.current.benchmark();
      setSpeed({ kind: 'done', factor: realtimeFactor });
    } catch {
      setSpeed({ kind: 'error' });
    }
  };

  const allReady = browserOk === true && model.kind === 'ready' && speed.kind === 'done' && separation.kind === 'ready';
  const markedReady = useRef(false);
  useEffect(() => {
    if (!allReady || markedReady.current) return;
    markedReady.current = true;
    const now = new Date().toISOString();
    setPreparedOn(now);
    try { localStorage.setItem('adl.prepared', now); } catch { /* storage blocked: the page still shows ready */ }
  }, [allReady]);

  const modelStatus: Status = model.kind === 'ready' ? 'ready' : model.kind === 'loading' ? 'progress' : model.kind === 'error' ? 'attention' : 'waiting';
  const speedStatus: Status = speed.kind === 'done' ? 'ready' : speed.kind === 'running' ? 'progress' : speed.kind === 'error' ? 'attention' : 'waiting';

  return (
    <div>
      <ol>
        <Row n={1} title="Browser" status={browserOk === null ? 'progress' : browserOk ? 'ready' : 'attention'}>
          {browserOk === null && <p>Checking this browser.</p>}
          {browserOk === true && <p>This browser can run transcription on this laptop.</p>}
          {browserOk === false && <p>Use Google Chrome (or Microsoft Edge) on a laptop.</p>}
        </Row>

        <Row n={2} title="Transcription model" status={modelStatus}>
          {model.kind === 'ready' && <p>The model is stored on this laptop. Recordings are transcribed here; the audio never leaves it.</p>}
          {model.kind === 'idle' && <p>The transcription model runs inside this browser. It is downloaded once and kept on this laptop.</p>}
          {model.kind === 'loading' && (
            <>
              <p>{model.fileNumber === 0 ? 'Starting the download.' : `Downloading file ${model.fileNumber} (${Math.round(model.bytes / 1_000_000)} MB so far). This can take several minutes.`}</p>
            </>
          )}
          {model.kind === 'error' && <p role="alert">The download stopped. Choose Download again to resume.</p>}
          {(model.kind === 'idle' || model.kind === 'error') && (
            <button className={button} disabled={browserOk !== true} onClick={() => void loadModel()}>
              {model.kind === 'error' ? 'Download again' : 'Download (about 700 MB, once)'}
            </button>
          )}
        </Row>

        <Row n={3} title="Speed test" status={speedStatus}>
          {speed.kind === 'done' && (
            <>
              <p>This laptop transcribes about {speed.factor.toFixed(1)}× faster than real time.</p>
              {speed.factor < 2 && <p>Recordings will take longer than their own length here; live sessions need a faster laptop.</p>}
            </>
          )}
          {speed.kind === 'running' && <p>Transcribing 30 seconds of test audio.</p>}
          {speed.kind === 'error' && <p role="alert">The speed test did not finish. Choose Run the speed test to try again.</p>}
          {(speed.kind === 'idle' || speed.kind === 'error') && (
            <>
              {model.kind !== 'ready' && <p>Available once the model is ready.</p>}
              <button className={button} disabled={model.kind !== 'ready'} onClick={() => void runSpeed()}>Run the speed test</button>
            </>
          )}
        </Row>

        <SpeakerSeparationRow n={4} state={separation} onLoad={() => void loadSeparation()} disabled={browserOk !== true} />
      </ol>

      {(allReady || (preparedOn !== null && browserOk === true)) && (
        <div className="mt-8 border-t border-border pt-6">
          <p className="text-[20px] text-ink">This laptop is ready</p>
          {!allReady && <p className="mt-1 text-sm text-ink-3">Prepared on {preparedOn?.slice(0, 10)}. The checks above confirm the model is still on this laptop.</p>}
          <Link href="/host" className={`${button} mt-4 inline-flex items-center`}>Go to your sessions</Link>
        </div>
      )}
    </div>
  );
}
