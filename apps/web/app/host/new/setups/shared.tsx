'use client';

import { useEffect, useRef, useState } from 'react';
import { listInputs, micError, tapAll } from '@/lib/live/capture';
import type { ChannelMap, Setup } from '@/lib/attribution/attributor';
import { hostConfirmsNote, type GateSetup } from '@/lib/attribution/gate';
import type { CaptureSpec } from '@/lib/live/capture';
import { rmsDb } from '@/lib/live/vad';

export const button = 'min-h-11 rounded border border-border-2 px-4 text-[15px] text-ink hover:bg-field-deep disabled:opacity-50';
export const primary = 'min-h-11 rounded-[3px] bg-ink px-5 py-2 text-sm text-field hover:bg-ink-2 disabled:opacity-40';
export const step = 'text-[15px] text-ink-2';

export type Person = { key: string; displayName: string; role: 'debater' | 'moderator' };
/** What a setup screen hands on: how to reopen the audio, the open streams, and who is on which input. */
export type SetupResult = { kind: Setup; spec: CaptureSpec; streams: MediaStream[]; channels: ChannelMap };

/**
 * Taps the streams while mounted and reports each channel's loudest frame (dB) ten times a second.
 * `onFrame` also receives every frame (enrollment records from it).
 */
export function useLevels(streams: MediaStream[], onFrame?: (channel: string, frame: Float32Array) => void, mono = false): { levels: Record<string, number>; error: string | null } {
  const [levels, setLevels] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const peak = useRef<Record<string, number>>({});
  const forward = useRef(onFrame);
  useEffect(() => { forward.current = onFrame; }, [onFrame]);

  useEffect(() => {
    if (streams.length === 0) return;
    let stop: (() => void) | null = null;
    let live = true;
    tapAll(streams, (c, f) => {
      peak.current[c] = Math.max(peak.current[c] ?? -100, rmsDb(f));
      forward.current?.(c, f);
    }, mono).then((s) => { if (live) stop = s; else s(); }, (e: unknown) => { if (live) setError(micError(e)); });
    const t = setInterval(() => { setLevels(peak.current); peak.current = {}; }, 100);
    return () => { live = false; clearInterval(t); stop?.(); };
  }, [streams, mono]);

  return { levels, error };
}

export function Meter({ label, db }: { label: string; db: number | undefined }) {
  const pct = Math.max(0, Math.min(100, (((db ?? -100) + 60) / 60) * 100));
  return (
    <div className="min-w-0 flex-1">
      <span className="text-sm text-ink-2">{label}</span>
      <div role="meter" aria-label={label} aria-valuemin={-60} aria-valuemax={0} aria-valuenow={Math.round(db ?? -60)} className="mt-1 h-2 w-full bg-field-deep">
        <div className="h-2 bg-ink" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** A select of this laptop's audio inputs and a button that uses the chosen one. */
export function DeviceSelect({ action, onUse, busy }: { action: string; onUse: (deviceId: string) => void; busy?: boolean }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[] | null>(null);
  const [chosen, setChosen] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    listInputs().then((d) => { if (live) { setDevices(d); setChosen(d[0]?.deviceId ?? ''); } }, (e: unknown) => { if (live) setError(micError(e)); });
    return () => { live = false; };
  }, []);
  if (error) return <p role="alert" className="text-[15px] text-ink">{error}</p>;
  if (!devices) return <p className={step}>Looking for audio inputs.</p>;
  if (devices.length === 0) return <p role="alert" className="text-[15px] text-ink">No audio input was found. Plug one in and reload the page.</p>;
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="min-w-0 flex-1 text-sm text-ink-2">Audio input
        <select className="mt-2 min-h-11 w-full rounded-[3px] border border-border bg-surface px-3 py-2 text-[16px]" value={chosen} onChange={(e) => setChosen(e.target.value)}>
          {devices.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Input device ${i + 1}`}</option>)}
        </select>
      </label>
      <button type="button" className={button} disabled={!chosen || busy} onClick={() => onUse(chosen)}>{action}</button>
    </div>
  );
}

export function Problems({ list }: { list: string[] }) {
  if (list.length === 0) return null;
  return (
    <ul role="alert" className="space-y-2 border border-border-2 p-4 text-[15px] text-ink">
      {list.map((p) => <li key={p}>{p}</li>)}
    </ul>
  );
}

/** Shown only where the measured gate holds every line for the host. */
export function HostConfirmsNote({ setup }: { setup: GateSetup }) {
  const note = hostConfirmsNote(setup);
  return note ? <p className="text-[15px] text-ink">{note}</p> : null;
}
