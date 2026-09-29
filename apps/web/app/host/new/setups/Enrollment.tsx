'use client';

import { useCallback, useRef, useState } from 'react';
import { enrollmentError, trimAnchor, type Anchor } from '@/lib/attribution/anchors';
import { channelOf } from '@/lib/live/live-view';
import { button, Meter, primary, step, useLevels, type Person, type SetupResult } from './shared';

/** The input a person's clip is recorded from: their own mic in the tracks setup, else the one feed. */
function sourceChannel(setup: SetupResult, key: string): string | undefined {
  return setup.kind === 'tracks' ? channelOf(setup.channels, key) : 'd0c0';
}

/** Records about 20 seconds from each person in turn; each clip is checked and trimmed into an anchor. */
export function Enrollment({ people: everyone, setup, onDone }: { people: Person[]; setup: SetupResult; onDone: (anchors: Anchor[]) => void }) {
  // In the tracks setup a person without an input is not recorded (another person's mic would give the wrong voice).
  const people = everyone.filter((p) => sourceChannel(setup, p.key) !== undefined);
  const skipped = everyone.filter((p) => sourceChannel(setup, p.key) === undefined);
  const [index, setIndex] = useState(0);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const anchors = useRef<Anchor[]>([]);
  const frames = useRef<Float32Array[]>([]);
  const person = people[index];
  const channel = (person && sourceChannel(setup, person.key)) ?? 'd0c0';

  const onFrame = useCallback((c: string, f: Float32Array) => {
    if (recording && c === channel) frames.current.push(f);
  }, [recording, channel]);
  const { levels, error: tapError } = useLevels(setup.streams, onFrame);

  const start = () => {
    frames.current = [];
    setError(null);
    setRecording(true);
  };

  const stop = () => {
    setRecording(false);
    if (!person) return;
    const pcm = new Float32Array(frames.current.reduce((n, f) => n + f.length, 0));
    frames.current.reduce((at, f) => (pcm.set(f, at), at + f.length), 0);
    frames.current = [];
    const problem = enrollmentError(person.displayName, pcm);
    if (problem) return setError(problem);
    anchors.current = [...anchors.current.filter((a) => a.key !== person.key), { key: person.key, pcm: trimAnchor(pcm) }];
    if (index + 1 < people.length) setIndex(index + 1);
    else onDone(anchors.current);
  };

  if (!person) return null;
  return (
    <div className="space-y-6">
      <h2 className="text-[20px] text-ink">Voices</h2>
      {setup.kind === 'tracks' && <p className={step}>Recommended: lets the app double-check the mics.</p>}
      <p className="text-sm text-ink-3">{index + 1} of {people.length}</p>
      {skipped.length > 0 && <p className="text-sm text-ink-3">{skipped.map((p) => p.displayName).join(', ')} {skipped.length === 1 ? 'has' : 'have'} no input, so {skipped.length === 1 ? 'is' : 'are'} not recorded here.</p>}
      <p className="text-[17px] text-ink">Ask {person.displayName} to talk for about 20 seconds: their name and what they hope to get from today.</p>
      <Meter label={setup.kind === 'tracks' ? `${person.displayName}'s input` : 'Input 1'} db={levels[channel]} />
      <div className="flex flex-wrap gap-3">
        {recording
          ? <button type="button" className={primary} onClick={stop}>Stop</button>
          : <button type="button" className={primary} onClick={start}>Record</button>}
        {setup.kind === 'tracks' && !recording && <button type="button" className={button} onClick={() => onDone(anchors.current)}>Skip</button>}
      </div>
      {error && <p role="alert" className="text-[15px] text-ink">{error}</p>}
      {tapError && <p role="alert" className="text-[15px] text-ink">{tapError}</p>}
    </div>
  );
}
