'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { checkTrackSettings, micError, openMicDevice, stopStreams } from '@/lib/live/capture';
import { DeviceSelect, Meter, primary, Problems, step, useLevels, type SetupResult } from './shared';

/** "One mic in the room": the laptop's own mic or one USB mic; speakers are told apart by voice. */
export function RoomSetup({ onDone }: { onDone: (r: SetupResult) => void }) {
  const [opened, setOpened] = useState<{ deviceId: string; stream: MediaStream; problems: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const handed = useRef(false);
  const latest = useRef<MediaStream | null>(null);
  const streams = useMemo(() => (opened ? [opened.stream] : []), [opened]);
  const { levels, error: tapError } = useLevels(streams);

  useEffect(() => { latest.current = opened?.stream ?? null; }, [opened]);
  useEffect(() => () => { if (!handed.current && latest.current) stopStreams([latest.current]); }, []);

  const use = async (deviceId: string) => {
    setBusy(true);
    setError(null);
    try {
      const stream = await openMicDevice(deviceId, 1);
      if (opened) stopStreams([opened.stream]);
      setOpened({ deviceId, stream, problems: checkTrackSettings(stream.getAudioTracks()[0]?.getSettings() ?? {}, { channels: 1 }) });
    } catch (e) {
      setError(micError(e));
    } finally {
      setBusy(false);
    }
  };

  const done = () => {
    if (!opened) return;
    handed.current = true;
    onDone({ kind: 'room', spec: { kind: 'mic', devices: [{ deviceId: opened.deviceId, channels: 1 }] }, streams, channels: {} });
  };

  return (
    <div className="space-y-6">
      <h2 className="text-[20px] text-ink">One mic in the room</h2>
      <p className={step}>Put the laptop (or the one mic) between the speakers, facing them, away from any loudspeakers.</p>
      <DeviceSelect action="Use this device" onUse={(id) => void use(id)} busy={busy} />
      {error && <p role="alert" className="text-[15px] text-ink">{error}</p>}
      {tapError && <p role="alert" className="text-[15px] text-ink">{tapError}</p>}
      {opened && <Problems list={opened.problems} />}
      {opened && <Meter label="Input 1" db={levels.d0c0} />}
      <button type="button" className={primary} disabled={!opened || opened.problems.length > 0} onClick={done}>Continue</button>
    </div>
  );
}
