'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { checkTrackSettings, micError, openMicDevice, stopStreams } from '@/lib/live/capture';
import { deviceAction, mappingComplete } from '@/lib/live/live-view';
import { button, DeviceSelect, Meter, primary, Problems, step, useLevels, type Person, type SetupResult } from './shared';

type Opened = { deviceId: string; stream: MediaStream; channels: 1 | 2; problems: string[] };

/** "Each speaker has their own mic": one or more 2-input interfaces (or USB mics), each input mapped to a person. */
export function MicSetup({ people, onDone }: { people: Person[]; onDone: (r: SetupResult) => void }) {
  const [devices, setDevices] = useState<Opened[]>([]);
  const [map, setMap] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const handed = useRef(false);
  const latest = useRef<Opened[]>([]);
  const debaters = people.filter((p) => p.role === 'debater');
  const streams = useMemo(() => devices.map((d) => d.stream), [devices]);
  const { levels, error: tapError } = useLevels(streams);
  const inputs = devices.flatMap((d, i) => Array.from({ length: d.channels }, (_, j) => `d${i}c${j}`));

  useEffect(() => { latest.current = devices; }, [devices]);
  useEffect(() => () => { if (!handed.current) stopStreams(latest.current.map((d) => d.stream)); }, []);

  const action = deviceAction(devices.map((d) => ({ channels: d.channels, problems: d.problems.length })), debaters.length);
  const use = async (deviceId: string) => {
    setBusy(true);
    setError(null);
    try {
      // Ask for two inputs; a USB mic gives one, and is checked (and stored) as one.
      const stream = await openMicDevice(deviceId, 2);
      const settings = stream.getAudioTracks()[0]?.getSettings() ?? {};
      const channels: 1 | 2 = settings.channelCount === 2 ? 2 : 1;
      const opened: Opened = { deviceId, stream, channels, problems: checkTrackSettings(settings, { channels }) };
      const keep = action === 'add' ? devices : devices.slice(0, -1);
      if (action === 'replace') stopStreams([devices.at(-1)!.stream]);
      setDevices([...keep, opened]);
      setMap({});
    } catch (e) {
      setError(micError(e));
    } finally {
      setBusy(false);
    }
  };

  const problems = devices.flatMap((d) => d.problems);
  const startOver = () => { stopStreams(devices.map((d) => d.stream)); setDevices([]); setMap({}); };
  const ready = devices.length > 0 && problems.length === 0 && mappingComplete(map, debaters.map((p) => p.key));
  const done = () => {
    handed.current = true;
    const channels = Object.fromEntries(Object.entries(map).filter(([, k]) => k));
    onDone({ kind: 'tracks', spec: { kind: 'mic', devices: devices.map((d) => ({ deviceId: d.deviceId, channels: d.channels })) }, streams, channels });
  };

  return (
    <div className="space-y-6">
      <h2 className="text-[20px] text-ink">Each speaker has their own mic</h2>
      <p className={step}>Plug the audio interface into this laptop. Put each debater&apos;s mic in its own input (debater 1 in input 1, debater 2 in input 2). Turn off any auto-gain or &lsquo;Air&rsquo; setting on the interface.</p>
      <DeviceSelect action={action === 'add' ? 'Add this device' : 'Use this device'} onUse={(id) => void use(id)} busy={busy} />
      {devices.length > 1 && <button type="button" className={button} onClick={startOver}>Start over</button>}
      {error && <p role="alert" className="text-[15px] text-ink">{error}</p>}
      {tapError && <p role="alert" className="text-[15px] text-ink">{tapError}</p>}
      <Problems list={problems} />
      {inputs.length > 0 && (
        <div className="space-y-4">
          <p className={step}>Ask each person to say their name. Choose who is speaking into each input.</p>
          {inputs.map((c, n) => (
            <div key={c} className="flex flex-wrap items-end gap-4">
              <Meter label={`Input ${n + 1}`} db={levels[c]} />
              <select aria-label={`Who is on input ${n + 1}`} className="min-h-11 rounded-[3px] border border-border bg-surface px-3 text-[16px]" value={map[c] ?? ''} onChange={(e) => setMap((m) => ({ ...m, [c]: e.target.value }))}>
                <option value="">Nobody</option>
                {people.map((p) => <option key={p.key} value={p.key}>{p.displayName}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-2 border border-border p-4 text-[15px] text-ink-2">
        <p>Some recorders (Zoom PodTrak, RØDECaster on a Mac) send one mixed signal over USB. If both meters move together whoever speaks, use the one-mic setup instead.</p>
        {debaters.length > 2 && <p>Chrome can read two inputs from one device. For three or four people, plug in a second interface or separate USB mics and add them here.</p>}
      </div>
      <button type="button" className={primary} disabled={!ready} onClick={done}>Continue</button>
      {devices.length > 0 && !ready && problems.length === 0 && <p className="text-sm text-ink-3">Each debater needs exactly one input.</p>}
    </div>
  );
}
