'use client';

import { useCallback, useRef, useState } from 'react';
import { enrollmentError, trimAnchor, type Anchor } from '@/lib/attribution/anchors';
import { channelOf, inputNumber } from '@/lib/live/live-view';
import { button, Meter, primary, step, useLevels, type Person, type SetupResult } from './shared';

/**
 * Records about 20 seconds from each person in turn; each clip is checked and trimmed into an anchor.
 * In the tracks setup a person with no input of their own is recorded from a mic the host picks (the
 * one they will be heard on), so their voice can be told apart from that mic's owner (P2-R8).
 */
export function Enrollment({ people, setup, onDone }: { people: Person[]; setup: SetupResult; onDone: (anchors: Anchor[]) => void }) {
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [index, setIndex] = useState(0);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const anchors = useRef<Anchor[]>([]);
  const frames = useRef<Float32Array[]>([]);
  const person = people[index];
  const own = person && setup.kind === 'tracks' ? channelOf(setup.channels, person.key) : undefined;
  const unmiked = setup.kind === 'tracks' && person !== undefined && own === undefined;
  const channel = setup.kind !== 'tracks' ? 'd0c0' : (own ?? (person ? picked[person.key] : undefined));
  const inputs = Object.keys(setup.channels).sort();
  const nameOf = (key: string) => people.find((p) => p.key === key)?.displayName ?? key;

  const onFrame = useCallback((c: string, f: Float32Array) => {
    if (recording && c === channel) frames.current.push(f);
  }, [recording, channel]);
  const { levels, error: tapError } = useLevels(setup.streams, onFrame, setup.kind !== 'tracks');

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
      {unmiked && (
        <div className="space-y-2">
          <p className="text-[15px] text-ink-2">{person.displayName} has no input of their own. Lines from anyone not enrolled wait for you to confirm who spoke.</p>
          <label className="block text-sm text-ink-2">Record {person.displayName} from which mic?
            <select className="mt-2 block min-h-11 rounded-[3px] border border-border bg-surface px-3 text-[16px]" value={channel ?? ''} disabled={recording}
              onChange={(e) => setPicked((m) => ({ ...m, [person.key]: e.target.value }))}>
              <option value="">Choose a mic</option>
              {inputs.map((c) => <option key={c} value={c}>Input {inputNumber(setup.channels, c)} ({nameOf(setup.channels[c]!)})</option>)}
            </select>
          </label>
        </div>
      )}
      <p className="text-[17px] text-ink">Ask {person.displayName} to talk for about 20 seconds: their name and what they hope to get from today.</p>
      {channel && <Meter label={setup.kind === 'tracks' ? `Input ${inputNumber(setup.channels, channel)}` : 'Input 1'} db={levels[channel]} />}
      <div className="flex flex-wrap gap-3">
        {recording
          ? <button type="button" className={primary} onClick={stop}>Stop</button>
          : <button type="button" className={primary} disabled={!channel} onClick={start}>Record</button>}
        {setup.kind === 'tracks' && !recording && <button type="button" className={button} onClick={() => onDone(anchors.current)}>Skip</button>}
      </div>
      {error && <p role="alert" className="text-[15px] text-ink">{error}</p>}
      {tapError && <p role="alert" className="text-[15px] text-ink">{tapError}</p>}
    </div>
  );
}
