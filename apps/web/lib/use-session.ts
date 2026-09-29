'use client';

/**
 * Live event log in the browser. Subscribes to the SSE stream, dedupes by
 * eventId, reconnects with `after=<cursor>`, and keeps a live projection that is
 * advanced incrementally. Playback surfaces call `projectAt` with a media time.
 */
import { useEffect, useMemo, useState } from 'react';
import { emptyState, type DomainEvent, type SessionState } from '@adl/core';
import { applySafe, projectAt, sessionMeta, type SessionMeta } from './derive';

/** `catching-up`: connected, still receiving the backlog; the state shown is not yet current. */
export type StreamStatus = 'connecting' | 'catching-up' | 'open' | 'reconnecting' | 'error';

export interface SessionData {
  events: readonly DomainEvent[];
  /** Bumps whenever events are appended. */
  version: number;
  status: StreamStatus;
  /** The live projection (all events). Mutated in place; read it during render. */
  live: SessionState;
  meta: SessionMeta;
}

/** Opens the stream. Call once per session (the /s/[session] layout does); read it with `useSession`. */
export function useSessionSource(sessionId: string): SessionData {
  // The log and its projection grow in place; `version` tells React when to re-read them.
  const [store, setStore] = useState(() => ({ events: [] as DomainEvent[], live: emptyState(sessionId) }));
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<StreamStatus>('connecting');

  useEffect(() => {
    const st = { events: [] as DomainEvent[], ids: new Set<string>(), live: emptyState(sessionId), cursor: 0 };
    // a new session gets a fresh log; this runs once per session id
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStore(st);
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    let stopped = false;
    let attempts = 0;

    const bump = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setVersion((v) => v + 1);
      });
    };

    const connect = () => {
      if (stopped) return;
      const url = `/api/events/stream?session=${encodeURIComponent(sessionId)}&view=console&after=${st.cursor}`;
      es = new EventSource(url);
      es.addEventListener('ready', () => {
        attempts = 0;
        setStatus('catching-up');
      });
      es.addEventListener('caughtup', () => setStatus('open'));
      es.addEventListener('reset', () => {
        // the local log was rewritten (a rerun): drop everything and rebuild from the new file
        st.events.length = 0;
        st.ids.clear();
        st.cursor = 0;
        Object.assign(st.live, emptyState(sessionId));
        bump();
      });
      es.addEventListener('events', (msg) => {
        const { cursor, events } = JSON.parse((msg as MessageEvent<string>).data) as { cursor: number; events: DomainEvent[] };
        let added = 0;
        for (const e of events) {
          if (st.ids.has(e.eventId)) continue;
          st.ids.add(e.eventId);
          st.events.push(e);
          applySafe(st.live, e); // mutates st.live in place (pure reducer over a private copy)
          added++;
        }
        // local mode: lines delivered; db mode: last row id. Either way, resume after it.
        if (Number.isFinite(cursor)) st.cursor = Math.max(st.cursor, cursor);
        if (added) bump();
      });
      es.onerror = () => {
        es?.close();
        if (stopped) return;
        setStatus('reconnecting');
        attempts++;
        retry = setTimeout(connect, Math.min(10_000, 500 * 2 ** Math.min(attempts, 5)));
      };
    };
    connect();
    return () => {
      stopped = true;
      es?.close();
      if (retry) clearTimeout(retry);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [sessionId]);

  // meta depends only on the log; recompute when it grows
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const meta = useMemo(() => sessionMeta(store.live), [store, version]);
  return { events: store.events, version, status, live: store.live, meta };
}

/** Projection at a media time (null = live). Recomputed from the log; cheap at R0 sizes. */
export function useStateAt(data: SessionData, tMs: number | null): SessionState {
  const bucket = tMs === null ? null : Math.floor(tMs / 250);
  return useMemo(
    () => (bucket === null ? data.live : projectAt(data.meta.sessionId, data.events, tMs ?? 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bucket, data.version, data.meta.sessionId],
  );
}
