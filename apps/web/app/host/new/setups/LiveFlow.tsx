'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { Anchor } from '@/lib/attribution/anchors';
import { idbAnchorsStore } from '@/lib/live/anchors-store';
import { stopStreams } from '@/lib/live/capture';
import { pendingLive, type LiveHandoff } from '@/lib/live/handoff';
import { rememberHostSession } from '@/lib/recording/host-sessions';
import { Enrollment } from './Enrollment';
import { MicSetup } from './MicSetup';
import { Rehearsal } from './Rehearsal';
import { RoomSetup } from './RoomSetup';
import type { Person, SetupResult } from './shared';
import { TabSetup } from './TabSetup';

export type LiveSource = 'mics' | 'call' | 'room';
export type LiveDraft = { title: string; format: string; participants: Person[]; seats: Record<string, string>; source: LiveSource };

/** Setup → voices → rehearsal; the session is created only when the host starts it. */
export function LiveFlow({ draft }: { draft: LiveDraft }) {
  const router = useRouter();
  const [setup, setSetup] = useState<SetupResult | null>(null);
  const [anchors, setAnchors] = useState<Anchor[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const handed = useRef(false);
  const streams = useRef<MediaStream[]>([]);
  const people = draft.participants;

  useEffect(() => { streams.current = setup?.streams ?? []; }, [setup]);
  useEffect(() => () => { if (!handed.current) stopStreams(streams.current); }, []);

  const start = async (clients: Omit<LiveHandoff, 'streams'>) => {
    if (!setup || !anchors) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/host/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: draft.title, format: draft.format, participants: people, seats: draft.seats, source: { kind: 'live' } }),
      });
      const body = (await res.json().catch(() => ({}))) as { sessionId?: string; error?: string };
      if (!res.ok || !body.sessionId) throw new Error(body.error ?? `The server returned ${res.status}`);
      const id = body.sessionId;
      const store = await idbAnchorsStore(id);
      try {
        await store.save({ setup: { kind: setup.kind, channels: setup.channels, participants: people.map(({ key, displayName }) => ({ key, displayName })) }, anchors, capture: setup.spec, startedAt: Date.now() });
      } finally {
        store.close();
      }
      rememberHostSession({ id, title: draft.title, createdAt: new Date().toISOString(), kind: 'live' });
      handed.current = true;
      pendingLive.set(id, { streams: setup.streams, ...clients });
      router.push(`/host/s/${encodeURIComponent(id)}`);
    } catch (err) {
      setError(`Session not started: ${err instanceof Error ? err.message : String(err)}`);
      setBusy(false);
      // The models were handed over; the rehearsal is gone, so free them.
      clients.asr?.terminate();
      clients.voices?.terminate();
    }
  };

  return (
    <div className="space-y-6">
      {!setup && draft.source === 'mics' && <MicSetup people={people} onDone={setSetup} />}
      {!setup && draft.source === 'call' && <TabSetup onDone={setSetup} />}
      {!setup && draft.source === 'room' && <RoomSetup onDone={setSetup} />}
      {setup && !anchors && <Enrollment people={people} setup={setup} onDone={setAnchors} />}
      {setup && anchors && !busy && <Rehearsal people={people} setup={setup} anchors={anchors} onStart={(c) => void start(c)} />}
      {busy && <p className="text-[15px] text-ink-2">Starting the session.</p>}
      {error && <p role="alert" className="text-[15px] text-ink">{error}</p>}
    </div>
  );
}
