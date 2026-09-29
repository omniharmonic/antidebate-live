'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AsrClient, readiness } from '@/lib/asr/client';

type Status = 'ready' | 'attention' | 'progress' | 'waiting';
type ModelState = { kind: 'idle' } | { kind: 'loading'; phase: 'download' | 'compile'; fraction: number } | { kind: 'ready' } | { kind: 'error' };
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

/**
 * Row 4 of the checklist. The speaker-separation bundle arrives with DiarizeClient;
 * until then this row says so plainly and does not count toward "ready".
 */
function SpeakerSeparationRow({ n }: { n: number }) {
  return (
    <Row n={n} title="Speaker separation" status="waiting">
      <p>Not available in this version yet. Recordings are transcribed without splitting speakers.</p>
    </Row>
  );
}

export function Prepare() {
  const [browserOk, setBrowserOk] = useState<boolean | null>(null);
  const [model, setModel] = useState<ModelState>({ kind: 'idle' });
  const [speed, setSpeed] = useState<SpeedState>({ kind: 'idle' });
  const client = useRef<AsrClient | null>(null);
  const loading = useRef(false);

  const loadModel = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    setModel({ kind: 'loading', phase: 'download', fraction: 0 });
    try {
      await navigator.storage?.persist?.();
      client.current?.terminate();
      client.current = await AsrClient.load((p) => setModel({ kind: 'loading', phase: p.phase, fraction: p.fraction }));
      setModel({ kind: 'ready' });
    } catch {
      setModel({ kind: 'error' });
    } finally {
      loading.current = false;
    }
  }, []);

  useEffect(() => {
    let live = true;
    void readiness().then((r) => {
      if (!live) return;
      setBrowserOk(r.browserOk);
      // Files already stored on this laptop load without a download.
      if (r.browserOk && r.modelCached) void loadModel();
    });
    return () => { live = false; client.current?.terminate(); client.current = null; };
  }, [loadModel]);

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

  // Rows 1 to 3 count toward "ready". Row 4 joins them when speaker separation ships.
  const allReady = browserOk === true && model.kind === 'ready' && speed.kind === 'done';
  const markedReady = useRef(false);
  useEffect(() => {
    if (!allReady || markedReady.current) return;
    markedReady.current = true;
    try { localStorage.setItem('adl.prepared', new Date().toISOString()); } catch { /* storage blocked: the page still shows ready */ }
  }, [allReady]);

  const modelStatus: Status = model.kind === 'ready' ? 'ready' : model.kind === 'loading' ? 'progress' : model.kind === 'error' ? 'attention' : 'waiting';
  const speedStatus: Status = speed.kind === 'done' ? 'ready' : speed.kind === 'running' ? 'progress' : speed.kind === 'error' ? 'attention' : 'waiting';
  const pct = model.kind === 'loading' ? Math.round(model.fraction * 100) : 0;

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
              <p>{model.phase === 'download' ? `Downloading, ${pct}%.` : 'Download finished. Preparing the model to run.'}</p>
              <div className="h-1.5 w-full rounded bg-field-deep" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Model download">
                <div className="h-full rounded bg-ink" style={{ width: `${pct}%` }} />
              </div>
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

        <SpeakerSeparationRow n={4} />
      </ol>

      {allReady && (
        <div className="mt-8 border-t border-border pt-6">
          <p className="text-[20px] text-ink">This laptop is ready</p>
          <Link href="/host" className={`${button} mt-4 inline-flex items-center`}>Go to your sessions</Link>
        </div>
      )}
    </div>
  );
}
