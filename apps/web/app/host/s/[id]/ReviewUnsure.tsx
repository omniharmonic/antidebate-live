'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReviewLine } from '@/lib/recording/pipeline';
import { groupReview } from '@/lib/recording/review';
import type { ReviewRequest } from './start-recording';

const small = 'min-h-11 rounded border border-border-2 px-3 text-[14px] text-ink hover:bg-field-deep disabled:opacity-50';
const chosen = 'bg-field-deep';
const CLIP_MS = 15_000;

/**
 * Lines the pipeline could not attribute with confidence. Lines from one separated voice are grouped
 * so a whole group can be assigned at once; each line can still be set on its own. Lines left
 * unassigned stay out of the map.
 */
export function ReviewUnsure({ request }: { request: ReviewRequest }) {
  const { lines, mono, participants } = request;
  const groups = useMemo(() => groupReview(lines), [lines]);
  const [assigned, setAssigned] = useState<Record<string, string>>({});
  const ctx = useRef<AudioContext | null>(null);
  const playing = useRef<AudioBufferSourceNode | null>(null);
  useEffect(() => () => { playing.current?.stop(); void ctx.current?.close(); }, []);

  const play = (l: ReviewLine) => {
    if (!mono) return;
    const from = Math.floor((l.startMs * 16_000) / 1000);
    const to = Math.min(mono.length, Math.floor((Math.min(l.endMs, l.startMs + CLIP_MS) * 16_000) / 1000));
    if (to <= from) return;
    ctx.current ??= new AudioContext();
    playing.current?.stop();
    const buf = ctx.current.createBuffer(1, to - from, 16_000);
    buf.copyToChannel(mono.slice(from, to), 0);
    const src = ctx.current.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.current.destination);
    src.start();
    playing.current = src;
  };

  const set = (ids: string[], key: string) => setAssigned((a) => ({ ...a, ...Object.fromEntries(ids.map((id) => [id, key])) }));
  const finish = () => {
    playing.current?.stop();
    request.resolve(Object.entries(assigned).map(([utteranceId, participantKey]) => ({ utteranceId, participantKey })));
  };
  const name = (k: string) => participants.find((p) => p.key === k)?.displayName ?? k;
  const guess = (l: ReviewLine) => Object.entries(l.candidates).sort((a, b) => b[1] - a[1])[0]?.[0];
  const left = lines.filter((l) => !assigned[l.utteranceId]).length;
  let voiceNo = 0;

  const lineRow = (l: ReviewLine) => {
    const g = guess(l);
    return (
      <li key={l.utteranceId} className="space-y-2 border-t border-border pt-3">
        <p className="text-[15px] text-ink">{g && <span className="text-ink-2">{name(g)}? </span>}{l.text}</p>
        <div className="flex flex-wrap gap-2">
          {mono && <button type="button" className={small} onClick={() => play(l)}>Play</button>}
          {participants.map((p) => (
            <button key={p.key} type="button" className={`${small} ${assigned[l.utteranceId] === p.key ? chosen : ''}`} aria-pressed={assigned[l.utteranceId] === p.key} onClick={() => set([l.utteranceId], p.key)}>{p.displayName}</button>
          ))}
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-6">
      <p className="text-[15px] text-ink-2">{lines.length} {lines.length === 1 ? 'line has' : 'lines have'} an unsure speaker. Assign the ones you can; the rest stay out of the map.</p>
      {!mono && <p className="text-sm text-ink-3">Choose the recording file again to listen to these lines.</p>}
      <div className="space-y-6">
        {groups.map((g) => {
          if (!g.label) return <ul key={g.lines[0]!.utteranceId}>{lineRow(g.lines[0]!)}</ul>;
          const ids = g.lines.map((l) => l.utteranceId);
          voiceNo += 1;
          return (
            <section key={g.label} className="space-y-3 border-t border-border pt-4">
              <div className="flex items-baseline justify-between gap-4">
                <h3 className="text-[17px] text-ink">Voice {voiceNo}</h3>
                <span className="text-sm text-ink-3">{g.lines.length} {g.lines.length === 1 ? 'line' : 'lines'}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-ink-2">All of this voice:</span>
                {participants.map((p) => (
                  <button key={p.key} type="button" className={`${small} ${ids.every((id) => assigned[id] === p.key) ? chosen : ''}`} aria-pressed={ids.every((id) => assigned[id] === p.key)} onClick={() => set(ids, p.key)}>{p.displayName}</button>
                ))}
              </div>
              <ul className="space-y-3">{g.lines.map(lineRow)}</ul>
            </section>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="min-h-11 rounded-[3px] bg-ink px-5 py-2 text-sm text-field hover:bg-ink-2 disabled:opacity-40" disabled={left > 0} onClick={finish}>Continue</button>
        <button type="button" className={small} onClick={finish}>Skip the rest</button>
        {left > 0 && <span className="text-sm text-ink-3">{left} {left === 1 ? 'line' : 'lines'} not assigned</span>}
      </div>
    </div>
  );
}
