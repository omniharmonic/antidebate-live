'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { groupVoices } from '@/lib/recording/voices';
import type { NamingRequest } from './start-recording';

const button = 'min-h-11 rounded border border-border-2 px-3 text-[14px] text-ink hover:bg-field-deep disabled:opacity-50';
const OTHER = '__other';
const CLIP_MS = 10_000;

const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`;

/** Each separated voice with its three longest stretches to listen to, and who it is. */
export function VoiceNaming({ request }: { request: NamingRequest }) {
  const { voices, shortLabels } = useMemo(() => groupVoices(request.segments), [request.segments]);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const ctx = useRef<AudioContext | null>(null);
  const playing = useRef<AudioBufferSourceNode | null>(null);

  useEffect(() => () => { playing.current?.stop(); void ctx.current?.close(); }, []);

  const play = (startMs: number, endMs: number) => {
    ctx.current ??= new AudioContext();
    playing.current?.stop();
    const from = Math.floor((startMs * 16_000) / 1000);
    const to = Math.min(request.mono.length, Math.floor((Math.min(endMs, startMs + CLIP_MS) * 16_000) / 1000));
    if (to <= from) return;
    const buf = ctx.current.createBuffer(1, to - from, 16_000);
    buf.copyToChannel(request.mono.slice(from, to), 0);
    const src = ctx.current.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.current.destination);
    src.start();
    playing.current = src;
  };

  const complete = voices.every((v) => choice[v.label]);
  const confirm = () => {
    playing.current?.stop();
    request.resolve({
      ...Object.fromEntries(shortLabels.map((l) => [l, null])),
      ...Object.fromEntries(voices.map((v) => [v.label, choice[v.label] === OTHER ? null : (choice[v.label] ?? null)])),
    });
  };

  return (
    <div className="space-y-6">
      <p className="text-[15px] text-ink-2">
        {voices.length === 0
          ? 'No separate voices were found. The transcript will be kept without speakers, and nothing will be counted as a participant\'s claim.'
          : `The recording has ${voices.length} ${voices.length === 1 ? 'voice' : 'voices'}. Listen to each and choose who it is. A voice marked as someone else stays in the transcript but is never counted as a participant's claim.`}
      </p>
      {shortLabels.length > 0 && (
        <p className="text-sm text-ink-3">{shortLabels.length} short {shortLabels.length === 1 ? 'voice' : 'voices'} (under 10 seconds each) {shortLabels.length === 1 ? 'is' : 'are'} left unattributed.</p>
      )}
      <ol className="space-y-5">
        {voices.map((v, i) => (
          <li key={v.label} className="border-t border-border pt-4 first:border-t-0">
            <div className="flex items-baseline justify-between gap-4">
              <h3 className="text-[17px] text-ink">Voice {i + 1}</h3>
              <span className="text-sm text-ink-3">{clock(v.totalMs)} of speech</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {v.longest.map((s) => (
                <button key={s.startMs} type="button" className={button} onClick={() => play(s.startMs, s.endMs)}>
                  Play from {clock(s.startMs)}
                </button>
              ))}
            </div>
            <label className="mt-3 block text-sm text-ink-2">
              Who is this?
              <select className="mt-1 min-h-11 w-full rounded-[3px] border border-border bg-surface px-3 text-[16px] text-ink focus:border-focus" value={choice[v.label] ?? ''} onChange={(e) => setChoice((c) => ({ ...c, [v.label]: e.target.value }))}>
                <option value="" disabled>Choose a person</option>
                {request.participants.map((p) => <option key={p.key} value={p.key}>{p.displayName}</option>)}
                <option value={OTHER}>Someone else (don&apos;t attribute)</option>
              </select>
            </label>
          </li>
        ))}
      </ol>
      <button type="button" disabled={!complete} className="min-h-11 rounded-[3px] bg-ink px-5 py-2 text-sm text-field hover:bg-ink-2 disabled:opacity-40" onClick={confirm}>
        Confirm voices and continue
      </button>
      {!complete && <p className="text-sm text-ink-3">Choose a person for every voice to continue.</p>}
    </div>
  );
}
