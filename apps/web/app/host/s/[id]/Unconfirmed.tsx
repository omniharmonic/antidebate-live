'use client';

import { useEffect, useRef, useState } from 'react';
import type { PendingLine } from '@/lib/live/live-view';

const small = 'min-h-11 rounded border border-border-2 px-3 text-[14px] text-ink hover:bg-field-deep disabled:opacity-50';

type Person = { key: string; displayName: string };

/** Plays 16 kHz clips kept in memory (the last 10 minutes of cuts). */
function usePlayer() {
  const ctx = useRef<AudioContext | null>(null);
  const playing = useRef<AudioBufferSourceNode | null>(null);
  useEffect(() => () => { playing.current?.stop(); void ctx.current?.close(); }, []);
  return (pcm: Float32Array) => {
    ctx.current ??= new AudioContext();
    playing.current?.stop();
    const buf = ctx.current.createBuffer(1, pcm.length, 16_000);
    buf.copyToChannel(pcm.slice(), 0);
    const src = ctx.current.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.current.destination);
    src.start();
    playing.current = src;
  };
}

const leaveOff = 'Not a speaker (leave off the map)';

/** One held line: its text, Play, a button per person, and Not a speaker. */
function Line({ id, text, guess, people, clip, play, busy, onPick, onDismiss }: {
  id: string; text: string; guess?: string; people: Person[]; clip: (id: string) => Float32Array | undefined; play: (pcm: Float32Array) => void;
  busy: boolean; onPick: (key: string) => void; onDismiss: () => void;
}) {
  const pcm = clip(id);
  return (
    <li className="space-y-2 border-t border-border pt-3">
      <p className="text-[15px] text-ink">{guess && <span className="text-ink-2">{guess}? </span>}{text}</p>
      <div className="flex flex-wrap gap-2">
        {pcm && <button type="button" className={small} onClick={() => play(pcm)}>Play</button>}
        {people.map((p) => <button key={p.key} type="button" className={small} disabled={busy} onClick={() => onPick(p.key)}>{p.displayName}</button>)}
        <button type="button" className={small} disabled={busy} onClick={onDismiss}>{leaveOff}</button>
      </div>
    </li>
  );
}

/**
 * Lines held out of the map until the host says who spoke, and voices nobody enrolled. A voice group
 * lists each of its lines, so the host sees what "all to NAME" confirms and can change any one of them.
 * "Not a speaker" takes lines off this list without writing anything: they stay held, off the map.
 */
export function Unconfirmed({ lines, voices, people, clip, onConfirm, onDismiss }: {
  lines: PendingLine[];
  voices: { label: string; utteranceIds: string[] }[];
  people: Person[];
  clip: (utteranceId: string) => Float32Array | undefined;
  onConfirm: (utteranceIds: string[], participantKey: string) => Promise<void>;
  onDismiss: (utteranceIds: string[]) => void;
}) {
  const play = usePlayer();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = (k: string) => people.find((p) => p.key === k)?.displayName ?? k;
  const byId = new Map(lines.map((l) => [l.utteranceId, l]));
  const groups = voices.map((v) => ({ ...v, utteranceIds: v.utteranceIds.filter((id) => byId.has(id)) })).filter((v) => v.utteranceIds.length > 0);
  const grouped = new Set(groups.flatMap((v) => v.utteranceIds));
  const guessOf = (l: PendingLine) => {
    const k = Object.entries(l.candidates).sort((a, b) => b[1] - a[1])[0]?.[0];
    return k ? name(k) : undefined;
  };

  const confirm = async (ids: string[], key: string, tag: string) => {
    setBusy(tag);
    setError(null);
    try { await onConfirm(ids, key); } catch (e) { setError(`Not saved: ${e instanceof Error ? e.message : String(e)}`); } finally { setBusy(null); }
  };
  const line = (l: PendingLine, tag: string, guess?: string) => (
    <Line key={l.utteranceId} id={l.utteranceId} text={l.text} people={people} clip={clip} play={play} busy={busy === tag || busy === l.utteranceId}
      onPick={(k) => void confirm([l.utteranceId], k, l.utteranceId)} onDismiss={() => onDismiss([l.utteranceId])} {...(guess ? { guess } : {})} />
  );

  const loose = lines.filter((l) => !grouped.has(l.utteranceId));
  if (loose.length === 0 && groups.length === 0) return null;
  return (
    <section className="space-y-4">
      <h2 className="label-caps">Waiting for you</h2>
      {error && <p role="alert" className="text-sm text-ink">{error}</p>}
      {groups.map((v) => (
        <div key={v.label} className="space-y-2 border-t border-border pt-3">
          <p className="text-[15px] text-ink">A new voice is speaking ({v.label}): {v.utteranceIds.length} {v.utteranceIds.length === 1 ? 'line' : 'lines'}. Name them?</p>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label={`Who is ${v.label}`} className="min-h-11 rounded-[3px] border border-border bg-surface px-3 text-[15px]" value="" disabled={busy === v.label}
              onChange={(e) => { if (e.target.value) void confirm(v.utteranceIds, e.target.value, v.label); }}>
              <option value="">All to…</option>
              {people.map((p) => <option key={p.key} value={p.key}>All to {p.displayName}</option>)}
            </select>
            <button type="button" className={small} disabled={busy === v.label} onClick={() => onDismiss(v.utteranceIds)}>{leaveOff}</button>
          </div>
          <ul className="space-y-3 pl-4">{v.utteranceIds.map((id) => line(byId.get(id)!, v.label))}</ul>
        </div>
      ))}
      <ul className="space-y-3">{loose.map((l) => line(l, l.utteranceId, guessOf(l)))}</ul>
    </section>
  );
}
