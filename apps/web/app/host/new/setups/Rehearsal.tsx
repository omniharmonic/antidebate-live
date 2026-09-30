'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Anchor } from '@/lib/attribution/anchors';
import { AsrClient } from '@/lib/asr/client';
import { DiarizeClient } from '@/lib/diarize/client';
import type { LiveHandoff } from '@/lib/live/handoff';
import { listen } from '@/lib/live/listen';
import { listenChannels, transcriptLines } from '@/lib/live/live-view';
import { MemoryEventLog } from '@/lib/live/memory-log';
import { LiveRunner } from '@/lib/live/runner';
import { button, primary, step, type Person, type SetupResult } from './shared';

const SECONDS = 30;
type Clients = Omit<LiveHandoff, 'streams'>;
type Line = { id: string; speaker: string; text: string };

/** Voice matching when speaker separation did not load: every line is held for the host. */
const noVoices = { matchVoices: () => Promise.reject(new Error('Speaker separation did not load.')) };

/** Thirty seconds of the live transcript into a throwaway log, to check names and levels before starting. */
export function Rehearsal({ people, setup, anchors, onStart }: { people: Person[]; setup: SetupResult; anchors: Anchor[]; onStart: (c: Clients) => void }) {
  const [clients, setClients] = useState<Clients | null>(null);
  const [model, setModel] = useState<string | null>('Loading the transcription model.');
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [left, setLeft] = useState(SECONDS);
  const [round, setRound] = useState(0);
  const [finished, setFinished] = useState(false);
  const handed = useRef(false);
  const stopRef = useRef<(() => void) | null>(null);
  const runnerRef = useRef<LiveRunner | null>(null);
  const names = useMemo(() => Object.fromEntries(people.map((p) => [p.key, p.displayName])), [people]);

  useEffect(() => {
    let live = true;
    const loaded: Clients = {};
    void (async () => {
      try {
        await Promise.all([
          AsrClient.load((p) => { if (live) setModel(`Downloading the transcription model: file ${p.fileNumber}, ${Math.round(p.bytes / 1_000_000)} MB so far.`); }).then((asr) => { if (live) loaded.asr = asr; else asr.terminate(); }),
          DiarizeClient.load().then((voices) => { if (live) loaded.voices = voices; else voices.terminate(); }).catch(() => undefined),
        ]);
        if (!live) return;
        setModel(null);
        setClients(loaded);
      } catch (e) {
        const mounted = live;
        loaded.asr?.terminate();
        loaded.voices?.terminate();
        live = false;
        if (!mounted) return;
        setModel(null);
        setError(`The transcription model did not load: ${e instanceof Error ? e.message : String(e)}. Open Prepare this laptop and try again.`);
      }
    })();
    return () => {
      live = false;
      if (!handed.current) { loaded.asr?.terminate(); loaded.voices?.terminate(); }
    };
  }, []);

  useEffect(() => {
    if (!clients?.asr) return;
    let live = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const log = new MemoryEventLog();
    const runner = new LiveRunner({
      sessionId: 'rehearsal',
      setup: { kind: setup.kind, channels: setup.channels, participants: people.map(({ key, displayName }) => ({ key, displayName })) },
      anchors,
      asr: clients.asr,
      voices: clients.voices ?? noVoices,
      voicesAvailable: !!clients.voices,
      log,
      onStatus: (status) => {
        if (!live) return;
        setLines(transcriptLines(log.events, names, 8));
        if (status.failed.length) setError(`Rehearsal could not process audio: ${status.failed[0]!.reason}`);
      },
    });
    runnerRef.current = runner;
    listen({ streams: setup.streams, channels: listenChannels(setup), mono: setup.kind !== 'tracks', runner, startedAt: Date.now() })
      .then((s) => {
        if (!live) { s(); return; }
        stopRef.current = s;
        timer = setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1000);
      }, (e: unknown) => { if (live) { setError(e instanceof Error ? e.message : String(e)); setFinished(true); } });
    return () => {
      live = false;
      clearInterval(timer);
      stopRef.current?.();
      stopRef.current = null;
      void runner.stop();
    };
  }, [clients, setup, people, anchors, names, round]);

  useEffect(() => {
    if (left > 0) return;
    stopRef.current?.();
    stopRef.current = null;
    const runner = runnerRef.current;
    void runner?.stop().then(() => { if (runnerRef.current === runner) setFinished(true); });
  }, [left]);

  const again = () => {
    setLines([]);
    setError(null);
    setFinished(false);
    setLeft(SECONDS);
    setRound((n) => n + 1);
  };

  const start = () => {
    if (!clients || !finished || !lines.length || error) return;
    handed.current = true;
    onStart(clients);
  };

  return (
    <div className="space-y-6">
      <h2 className="text-[20px] text-ink">Rehearsal</h2>
      <p className={step}>Talk for a moment to check the transcript.</p>
      {model && <p className="text-[15px] text-ink-2">{model}</p>}
      {error && <p role="alert" className="text-[15px] text-ink">{error}</p>}
      {clients && !clients.voices && <p className="text-[15px] text-ink-2">Speaker separation did not load, so every line will wait for you to confirm who spoke.</p>}
      {clients && <p className="text-sm text-ink-3" aria-live="polite">{left > 0 ? `Listening: ${left} s left` : !finished ? 'Finishing the transcript…' : lines.length ? 'Rehearsal finished. Check the words and speaker names before starting.' : 'No speech was transcribed. Check your input and rehearse again.'}</p>}
      <ul className="space-y-2">
        {lines.map((l) => (
          <li key={l.id} className="text-[15px] text-ink"><span className="text-ink-2">{l.speaker}:</span> {l.text}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-3">
        <button type="button" className={primary} disabled={!clients || !finished || !lines.length || !!error} onClick={start}>Looks right: start the session</button>
        {clients && finished && <button type="button" className={button} onClick={again}>Check again</button>}
      </div>
    </div>
  );
}
