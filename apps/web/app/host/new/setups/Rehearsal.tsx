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
  const handed = useRef(false);
  const stopRef = useRef<(() => void) | null>(null);
  const runnerRef = useRef<LiveRunner | null>(null);
  const names = useMemo(() => Object.fromEntries(people.map((p) => [p.key, p.displayName])), [people]);

  useEffect(() => {
    let live = true;
    let loaded: Clients = {};
    void (async () => {
      try {
        const [asr, voices] = await Promise.all([
          AsrClient.load((p) => { if (live) setModel(`Downloading the transcription model: file ${p.fileNumber}, ${Math.round(p.bytes / 1_000_000)} MB so far.`); }),
          DiarizeClient.load().catch(() => undefined),
        ]);
        loaded = { asr, ...(voices ? { voices } : {}) };
        if (!live) return;
        setModel(null);
        setClients(loaded);
      } catch (e) {
        if (live) setError(`The transcription model did not load: ${e instanceof Error ? e.message : String(e)}. Open Prepare this laptop and try again.`);
      }
    })();
    return () => {
      live = false;
      if (!handed.current) { loaded.asr?.terminate(); loaded.voices?.terminate(); }
    };
  }, []);

  useEffect(() => {
    if (!clients?.asr) return;
    const log = new MemoryEventLog();
    const runner = new LiveRunner({
      sessionId: 'rehearsal',
      setup: { kind: setup.kind, channels: setup.channels, participants: people.map(({ key, displayName }) => ({ key, displayName })) },
      anchors,
      asr: clients.asr,
      voices: clients.voices ?? noVoices,
      log,
      onStatus: () => setLines(transcriptLines(log.events, names, 8)),
    });
    let live = true;
    runnerRef.current = runner;
    listen({ streams: setup.streams, channels: listenChannels(setup), runner, startedAt: Date.now() })
      .then((s) => { if (live) stopRef.current = s; else s(); }, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    const t = setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1000);
    return () => {
      live = false;
      clearInterval(t);
      stopRef.current?.();
      stopRef.current = null;
      void runner.stop();
    };
  }, [clients, setup, people, anchors, names, round]);

  useEffect(() => {
    if (left > 0) return;
    stopRef.current?.();
    stopRef.current = null;
    void runnerRef.current?.stop();
  }, [left]);

  const again = () => {
    setLines([]);
    setLeft(SECONDS);
    setRound((n) => n + 1);
  };

  const start = () => {
    if (!clients) return;
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
      {clients && <p className="text-sm text-ink-3" aria-live="polite">{left > 0 ? `Listening: ${left} s left` : 'Rehearsal finished.'}</p>}
      <ul className="space-y-2">
        {lines.map((l) => (
          <li key={l.id} className="text-[15px] text-ink"><span className="text-ink-2">{l.speaker}:</span> {l.text}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-3">
        <button type="button" className={primary} disabled={!clients} onClick={start}>Looks right: start the session</button>
        {clients && left === 0 && <button type="button" className={button} onClick={again}>Check again</button>}
      </div>
    </div>
  );
}
