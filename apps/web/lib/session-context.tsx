'use client';

/**
 * One event stream per session, shared by every surface under /s/[session]
 * (the layout owns it), plus the Explore state that should survive a lens
 * switch: the playhead, playback speed, time window and selected proposition.
 * The playhead and selection are mirrored into the URL (?t=<seconds>&sel=<id>)
 * so a moment can be linked.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { endOf } from './derive';
import { useSessionSource, type SessionData } from './use-session';

const SessionCtx = createContext<SessionData | null>(null);

export type TimeWindow = 'full' | 300_000 | 900_000 | 'round';
export type Speed = 1 | 4 | 16;

export interface Playhead {
  /** Media time in ms; null follows the newest moment (live) or the end (recording). */
  t: number | null;
  /** t resolved against the session end. */
  tNow: number;
  endMs: number;
  setT: (t: number | null) => void;
  playing: boolean;
  togglePlay: () => void;
  pause: () => void;
  speed: Speed;
  setSpeed: (s: Speed) => void;
  window: TimeWindow;
  setWindow: (w: TimeWindow) => void;
  selected: string | null;
  select: (id: string | null) => void;
  /** Query string carrying t and sel, for links between lenses. */
  query: string;
}

const PlayheadCtx = createContext<Playhead | null>(null);

const EXPLORE = /\/(spatial|arc|positions)$/;

export function SessionProvider({ sessionId, children }: { sessionId: string; children: React.ReactNode }) {
  const data = useSessionSource(sessionId);
  const endMs = Math.max(endOf(data.live), 60_000);
  const pathname = usePathname();

  const [t, setTState] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [win, setWindow] = useState<TimeWindow>('full');
  const [selected, setSelected] = useState<string | null>(null);

  // Restore shared links and browser Back/Forward without losing the selected moment.
  useEffect(() => {
    const restore = () => {
      const q = new URLSearchParams(window.location.search);
      const ts = q.get('t');
      setTState(ts !== null && ts.trim() !== '' && Number.isFinite(Number(ts)) ? Math.max(0, Number(ts) * 1000) : null);
      setSelected(q.get('sel'));
      setPlaying(false);
    };
    restore();
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  const endRef = useRef(endMs);
  useEffect(() => {
    endRef.current = endMs;
  }, [endMs]);

  const setT = useCallback((v: number | null) => setTState(v === null ? null : Math.max(0, Math.min(v, endRef.current))), []);
  const pause = useCallback(() => setPlaying(false), []);
  const togglePlay = useCallback(() => {
    setPlaying((p) => {
      if (!p) setTState((cur) => (cur === null || cur >= endRef.current - 500 ? 0 : cur));
      return !p;
    });
  }, []);

  // playback clock
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      setTState((cur) => {
        const next = (cur ?? 0) + dt * speed;
        if (next >= endRef.current) {
          setPlaying(false);
          return null;
        }
        return next;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed]);

  // keyboard: space plays, arrows seek, Escape clears the selection (Explore lenses only)
  const explore = EXPLORE.test(pathname ?? '');
  useEffect(() => {
    if (!explore) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'A' || el?.getAttribute('role') === 'button') {
        if (e.key !== 'Escape') return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const d = (e.shiftKey ? 60_000 : 10_000) * (e.key === 'ArrowLeft' ? -1 : 1);
        setPlaying(false);
        setTState((cur) => Math.min(endRef.current, Math.max(0, (cur ?? endRef.current) + d)));
      } else if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [explore, togglePlay]);

  // mirror t and sel into the URL (not while playing; replaceState keeps history clean)
  const tSec = t === null ? null : Math.round(t / 1000);
  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (tSec !== null) q.set('t', String(tSec));
    if (selected) q.set('sel', selected);
    const s = q.toString();
    return s ? `?${s}` : '';
  }, [tSec, selected]);
  useEffect(() => {
    if (playing || !explore) return;
    try {
      const url = new URL(window.location.href);
      if (url.search === query) return;
      window.history.replaceState(window.history.state, '', `${url.pathname}${query}`);
    } catch {}
  }, [query, playing, explore]);

  const playhead = useMemo<Playhead>(
    () => ({
      // A shared link may carry a time past the end (or the log may still be catching up): clamp.
      t: t === null ? null : Math.min(t, endMs),
      tNow: t === null ? endMs : Math.min(t, endMs),
      endMs,
      setT,
      playing,
      togglePlay,
      pause,
      speed,
      setSpeed,
      window: win,
      setWindow,
      selected,
      select: setSelected,
      query,
    }),
    [t, endMs, setT, playing, togglePlay, pause, speed, win, selected, query],
  );

  return (
    <SessionCtx.Provider value={data}>
      <PlayheadCtx.Provider value={playhead}>{children}</PlayheadCtx.Provider>
    </SessionCtx.Provider>
  );
}

/** The session stream opened by the /s/[session] layout. */
export function useSession(): SessionData {
  const v = useContext(SessionCtx);
  if (!v) throw new Error('useSession must be used inside <SessionProvider>');
  return v;
}

export function usePlayhead(): Playhead {
  const v = useContext(PlayheadCtx);
  if (!v) throw new Error('usePlayhead must be used inside <SessionProvider>');
  return v;
}
