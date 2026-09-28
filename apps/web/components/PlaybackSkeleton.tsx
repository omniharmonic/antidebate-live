'use client';

/**
 * Playback skeleton (UX §7). Proves the core projections run in the browser:
 * scrub the playhead and the state is recomputed from the event log.
 * To build: media sync, snapshots, lenses, 3D topology (WS5).
 */
import { useMemo, useState } from 'react';
import { stateAt, type DomainEvent } from '@adl/core';

const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function PlaybackSkeleton({ sessionId, events }: { sessionId: string; events: DomainEvent[] }) {
  const endMs = events.at(-1)?.mediaMs ?? 0;
  const [t, setT] = useState(Math.min(10 * 60_000, endMs));
  const state = useMemo(() => stateAt(sessionId, events, t), [sessionId, events, t]);
  const colorFor = (key: string) => (key === 'A' ? 'var(--voice-a)' : key === 'B' ? 'var(--voice-b)' : 'var(--ink-3)');
  const recent = state.utteranceOrder.slice(-12).map((id) => state.utterances.get(id)!);

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <p className="font-mono text-xs uppercase tracking-widest text-ink-3">Playback · skeleton</p>
      <h1 className="mt-2 text-4xl">{state.title || sessionId}</h1>
      <p className="mt-2 text-sm text-ink-2">
        {state.participants.map((p) => `${p.key} ${p.displayName}`).join(' · ')} · {state.utteranceOrder.length} utterances at playhead ·{' '}
        {state.propositions.size} propositions
      </p>

      <label htmlFor="playhead" className="mt-8 flex items-center gap-4 font-mono text-sm">
        <span className="w-14 tabular-nums">{fmt(t)}</span>
        <input id="playhead" type="range" min={0} max={endMs} step={1000} value={t} onChange={(e) => setT(Number(e.target.value))} className="flex-1" />
        <span className="w-14 text-right tabular-nums text-ink-3">{fmt(endMs)}</span>
      </label>

      <ol className="mt-8 space-y-4">
        {recent.map((u) => (
          <li key={u.id} className="grid grid-cols-[3.5rem_1.5rem_1fr] gap-3 text-[15px] leading-relaxed">
            <span className="font-mono text-xs text-ink-3 tabular-nums">{fmt(u.startMs)}</span>
            <span className="font-mono text-xs font-medium" style={{ color: colorFor(u.participantKey) }}>
              {u.participantKey}
            </span>
            <span>{u.text}</span>
          </li>
        ))}
      </ol>
    </main>
  );
}
