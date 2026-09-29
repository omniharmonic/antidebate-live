'use client';

/**
 * The persistent temporal dock (DIRECTION §6 "Time"). Play at 1×/4×/16×, a
 * scrubber marked with the format's phases and the rounds actually started
 * (round.started events), an optional time window, and an explicit return to
 * the newest moment. "Replay" and "Following live" are stated separately.
 */
import { clock, type Band, type RoundMark } from '@/lib/derive';
import { usePlayhead, type Speed, type TimeWindow } from '@/lib/session-context';

const WINDOWS: { v: TimeWindow; label: string }[] = [
  { v: 'full', label: 'Full conversation' },
  { v: 'round', label: 'Current round' },
  { v: 900_000, label: 'Last 15 minutes' },
  { v: 300_000, label: 'Last 5 minutes' },
];

export function TimeDock({ rounds, bands, ended, windowControl = false }: { rounds: RoundMark[]; bands: Band[]; ended: boolean; windowControl?: boolean }) {
  const ph = usePlayhead();
  const { tNow, endMs, t } = ph;
  const pct = (ms: number) => `${(Math.min(Math.max(ms, 0), endMs) / endMs) * 100}%`;
  const currentRound = [...rounds].reverse().find((r) => r.startMs <= tNow);
  const following = t === null && !ended;
  const mode = following ? 'Following live' : t === null ? 'End of recording' : 'Replay';

  return (
    <div className="time-dock shrink-0 border-t border-border bg-field">
      <div className="time-dock-inner">
        <button
          type="button"
          onClick={ph.togglePlay}
          aria-label={ph.playing ? 'Pause' : 'Play'}
          className="transport-play flex h-11 min-w-[92px] items-center justify-center gap-2.5 rounded-[3px] border border-border-2 px-4 text-[14px] text-ink hover:bg-field-deep"
        >
          {ph.playing ? (
            <svg width="12" height="12" aria-hidden>
              <rect x="1" y="1" width="3.5" height="10" fill="currentColor" />
              <rect x="7.5" y="1" width="3.5" height="10" fill="currentColor" />
            </svg>
          ) : (
            <svg width="12" height="12" aria-hidden>
              <path d="M2 1 L11 6 L2 11 Z" fill="currentColor" />
            </svg>
          )}
          {ph.playing ? 'Pause' : 'Play'}
        </button>
        <div role="group" aria-label="Playback speed" className="transport-speed flex h-11 overflow-hidden rounded-[3px] border border-border">
          {([1, 4, 16] as Speed[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => ph.setSpeed(v)}
              aria-pressed={ph.speed === v}
              className={`w-11 font-mono text-[12px] ${ph.speed === v ? 'bg-field-deep text-ink' : 'text-ink-3 hover:text-ink'}`}
            >
              {v}×
            </button>
          ))}
        </div>

        <div className="transport-track min-w-0">
          {/* phases and rounds */}
          <div className="relative h-5 text-[12px] text-ink-3" aria-hidden>
            {bands
              .filter((b) => b.phase !== 'none' || bands.length === 1)
              .map((b, i) => (
                <span key={`${b.name}${i}`} className="absolute top-0 truncate border-l border-border-2 pl-1.5 leading-4" style={{ left: pct(b.startMs), maxWidth: `calc(${pct(b.endMs)} - ${pct(b.startMs)})` }} title={b.name}>
                  {b.name}
                </span>
              ))}
          </div>
          <div className="relative">
            <div className="pointer-events-none absolute inset-x-0 top-[13px] h-[2px]" aria-hidden>
              <div className="absolute inset-y-0 left-0 bg-ink-2" style={{ width: pct(tNow) }} />
              {rounds.map((r) => (
                <span key={`${r.roundId}${r.startMs}`} className="absolute -top-[5px] h-3 w-px bg-ink-3" style={{ left: pct(r.startMs) }} />
              ))}
            </div>
            <label className="block">
              <span className="sr-only">Playhead</span>
              <input
                type="range"
                className="scrubber relative"
                min={0}
                max={endMs}
                step={1000}
                value={Math.round(tNow)}
                aria-valuetext={`${clock(tNow)} of ${clock(endMs)}${currentRound ? `, ${currentRound.name}` : ''}`}
                onChange={(e) => {
                  ph.pause();
                  ph.setT(Number(e.target.value));
                }}
              />
            </label>
          </div>
          <div className="flex items-baseline justify-between gap-4 text-[12px]">
            {rounds.length ? <select aria-label="Jump to round" value={currentRound ? String(currentRound.startMs) : ''} onChange={(e) => { ph.pause(); ph.setT(Number(e.target.value)); }} className="round-jump min-w-0 max-w-[60%] bg-field text-ink-2">
              {!currentRound ? <option value="" disabled>Jump to round</option> : null}
              {rounds.map((r) => <option key={`${r.roundId}:${r.startMs}`} value={String(r.startMs)}>{r.name}</option>)}
            </select> : <span className="text-ink-3">No rounds marked</span>}
            <span className="shrink-0 font-mono text-ink-3 tabular">
              <span className="text-ink">{clock(tNow)}</span> / {clock(endMs)}
            </span>
          </div>
        </div>

        {windowControl ? (
          <label className="transport-window flex items-center gap-2 text-[13px] text-ink-3">
            <span>Time window</span>
            <select
              value={String(ph.window)}
              onChange={(e) => {
                const v = e.target.value;
                ph.setWindow(v === 'full' || v === 'round' ? v : (Number(v) as TimeWindow));
              }}
              className="h-11 rounded-[3px] border border-border bg-field px-2 text-[13px] text-ink"
            >
              {WINDOWS.map((w) => (
                <option key={String(w.v)} value={String(w.v)}>
                  {w.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="transport-live flex items-center justify-end gap-3">
          <span className="hidden text-[13px] text-ink-2 2xl:inline" role="status">
            {mode}
          </span>
          <button
            type="button"
            onClick={() => {
              ph.pause();
              ph.setT(null);
            }}
            disabled={t === null}
            className="h-11 whitespace-nowrap rounded-[3px] border border-border px-3 text-[13px] text-ink-2 hover:text-ink disabled:opacity-40"
          >
            {t === null ? (ended ? 'At end' : 'Following live') : (ended ? 'Go to end' : 'Return to live')}
          </button>
        </div>
      </div>
    </div>
  );
}
