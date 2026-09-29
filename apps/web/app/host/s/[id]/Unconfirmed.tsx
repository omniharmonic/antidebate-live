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

/**
 * Lines held out of the map until the host says who spoke, and voices nobody enrolled. Confirming
 * a voice group confirms every line in it.
 */
export function Unconfirmed({ lines, voices, people, clip, onConfirm }: {
  lines: PendingLine[];
  voices: { label: string; utteranceIds: string[] }[];
  people: Person[];
  clip: (utteranceId: string) => Float32Array | undefined;
  onConfirm: (utteranceIds: string[], participantKey: string) => Promise<void>;
}) {
  const play = usePlayer();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = (k: string) => people.find((p) => p.key === k)?.displayName ?? k;
  const grouped = new Set(voices.flatMap((v) => v.utteranceIds));

  const confirm = async (ids: string[], key: string, tag: string) => {
    setBusy(tag);
    setError(null);
    try { await onConfirm(ids, key); } catch (e) { setError(`Not saved: ${e instanceof Error ? e.message : String(e)}`); } finally { setBusy(null); }
  };

  const loose = lines.filter((l) => !grouped.has(l.utteranceId));
  if (loose.length === 0 && voices.length === 0) return null;
  return (
    <section className="space-y-4">
      <h2 className="label-caps">Waiting for you</h2>
      {error && <p role="alert" className="text-sm text-ink">{error}</p>}
      {voices.map((v) => {
        const first = v.utteranceIds[0];
        const pcm = first ? clip(first) : undefined;
        return (
          <div key={v.label} className="space-y-2 border-t border-border pt-3">
            <p className="text-[15px] text-ink">A new voice is speaking ({v.label}). Name them?</p>
            <div className="flex flex-wrap items-center gap-2">
              {pcm && <button type="button" className={small} onClick={() => play(pcm)}>Play</button>}
              <select aria-label={`Who is ${v.label}`} className="min-h-11 rounded-[3px] border border-border bg-surface px-3 text-[15px]" value="" disabled={busy === v.label}
                onChange={(e) => { if (e.target.value) void confirm(v.utteranceIds, e.target.value, v.label); }}>
                <option value="">Choose who</option>
                {people.map((p) => <option key={p.key} value={p.key}>{p.displayName}</option>)}
              </select>
              <span className="text-sm text-ink-3">{v.utteranceIds.length} {v.utteranceIds.length === 1 ? 'line' : 'lines'}</span>
            </div>
          </div>
        );
      })}
      <ul className="space-y-3">
        {loose.map((l) => {
          const pcm = clip(l.utteranceId);
          const guess = Object.entries(l.candidates).sort((a, b) => b[1] - a[1])[0]?.[0];
          return (
            <li key={l.utteranceId} className="space-y-2 border-t border-border pt-3">
              <p className="text-[15px] text-ink">{guess && <span className="text-ink-2">{name(guess)}? </span>}{l.text}</p>
              <div className="flex flex-wrap gap-2">
                {pcm && <button type="button" className={small} onClick={() => play(pcm)}>Play</button>}
                {people.map((p) => (
                  <button key={p.key} type="button" className={small} disabled={busy === l.utteranceId} onClick={() => void confirm([l.utteranceId], p.key, l.utteranceId)}>{p.displayName}</button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
