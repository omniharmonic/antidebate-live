'use client';

/**
 * Stage output skeleton (UX §5.1). Subscribes to the audience-filtered stream
 * and renders the current dial level. Level 0 ("Dark") is Stephanie's Oct 11 default.
 * To build: levels 1–5 layouts, spotlight, crossfades, 3D cinematic mode (WS4/WS5).
 */
import { useEffect, useState } from 'react';
import type { AudienceView } from '@adl/core';

export function StageOutput({ channel, session }: { channel: string; session: string }) {
  const [view, setView] = useState<AudienceView | null>(null);
  useEffect(() => {
    const es = new EventSource(`/api/events/stream?session=${encodeURIComponent(session)}&view=stage:${encodeURIComponent(channel)}`);
    es.addEventListener('audience', (e) => setView(JSON.parse((e as MessageEvent).data) as AudienceView));
    es.addEventListener('end', () => es.close());
    return () => es.close();
  }, [channel, session]);

  return (
    <main data-surface="stage" className="grid min-h-dvh place-items-center bg-field px-8 text-ink">
      {!view || view.level === 0 ? (
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-ink-ghost" aria-label="Stage is dark">
          {view?.frame?.title ?? ''}
        </p>
      ) : (
        <div className="text-center">
          <p className="font-mono text-xs uppercase tracking-widest text-ink-3">{view.frame?.round ?? ''}</p>
          <h1 className="mx-auto mt-4 max-w-[24ch] text-[clamp(32px,5vw,72px)] leading-tight">{view.frame?.title}</h1>
        </div>
      )}
    </main>
  );
}
