'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { micError, openTabAudio, stopStreams } from '@/lib/live/capture';
import { button, Meter, primary, step, useLevels, type SetupResult } from './shared';

/** "Video call": the call's audio from a shared browser tab (or system audio for the Zoom app). */
export function TabSetup({ onDone }: { onDone: (r: SetupResult) => void }) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handed = useRef(false);
  const latest = useRef<MediaStream | null>(null);
  const streams = useMemo(() => (stream ? [stream] : []), [stream]);
  const { levels, error: tapError } = useLevels(streams);

  useEffect(() => { latest.current = stream; }, [stream]);
  useEffect(() => () => { if (!handed.current && latest.current) stopStreams([latest.current]); }, []);

  const share = async () => {
    setError(null);
    try {
      const s = await openTabAudio();
      if (stream) stopStreams([stream]);
      setStream(s);
    } catch (e) {
      // Closing the picker without choosing is not an error worth showing.
      if (!(e instanceof Error && e.name === 'NotAllowedError')) setError(micError(e));
    }
  };

  const done = () => {
    if (!stream) return;
    handed.current = true;
    onDone({ kind: 'call', spec: { kind: 'tab' }, streams, channels: {} });
  };

  return (
    <div className="space-y-6">
      <h2 className="text-[20px] text-ink">Video call</h2>
      <ol className="list-decimal space-y-3 pl-5 text-[15px] text-ink-2">
        <li>Join the call from a second Chrome window, muted, with your camera off. Name yourself &lsquo;Anti-Debate notes&rsquo; so people know why you&apos;re there.</li>
        <li>Choose Share tab audio, pick that call&apos;s tab, and make sure &lsquo;Share tab audio&rsquo; is ticked.</li>
      </ol>
      <button type="button" className={button} onClick={() => void share()}>Share tab audio</button>
      <p className={step}>If the call is in the Zoom app rather than a browser tab, choose Share system audio (Chrome on macOS 14.2 or later, or Windows).</p>
      <button type="button" className={button} onClick={() => void share()}>Share system audio</button>
      {error && <p role="alert" className="text-[15px] text-ink">{error}</p>}
      {tapError && <p role="alert" className="text-[15px] text-ink">{tapError}</p>}
      {stream && <Meter label="Call audio" db={levels.d0c0} />}
      <p className="text-sm text-ink-3">For a cleaner map afterwards, record the call with a separate audio file for each person and process that recording here. Zoom: Settings → Recording → &lsquo;Record a separate audio file for each participant&rsquo;. Riverside does this by default. StreamYard does it for local recordings; its cloud recordings need the Advanced plan, with separate tracks switched on before going live.</p>
      <button type="button" className={primary} disabled={!stream} onClick={done}>Continue</button>
    </div>
  );
}
