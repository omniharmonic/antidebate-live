'use client';

/**
 * Explore › Positions: the list equivalent of the spatial map (UX §7 "Positions
 * Matrix"; DIRECTION §9). Propositions grouped by stratum, each debater's stance
 * at the playhead, the crux candidate marked, sources one selection away. Fully
 * keyboard operable; this is the non-pointer path to everything the 3D view shows.
 */
import { useMemo, useRef, useState } from 'react';
import type { Stance } from '@adl/ontology';
import { SessionBar } from '@/components/SessionBar';
import { TimeDock } from '@/components/explore/TimeDock';
import { HigherGroundInspector, PropositionInspector, StanceGlyph } from '@/components/explore/Inspector';
import { ATTITUDE_LABEL, VOICE_VAR, clock, voiceColor, type SessionMeta } from '@/lib/derive';
import { usePlayhead, useSession } from '@/lib/session-context';
import { STRATA, STRATUM_GLOSS, STRATUM_LABEL, arrangeAt, buildSpatialModel, type Placed, type Tone } from '@/lib/spatial-model';

type Filter = 'all' | 'disputed' | 'shared' | 'a' | 'b' | 'unheld';

interface Row {
  pid: string;
  alias: string;
  canonical: string;
  type: string;
  stratum: (typeof STRATA)[number];
  firstMs: number;
  tone: Tone | 'unheld';
  a?: Stance;
  b?: Stance;
  crux: boolean;
}

export function Positions() {
  const data = useSession();
  const { live, meta, events, version } = data;
  const ph = usePlayhead();
  const { tNow, endMs, selected, select } = ph;
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const model = useMemo(() => buildSpatialModel(live, events, meta, endMs), [version, endMs, meta]);
  const bucket = Math.floor(tNow / 500);
  const arr = useMemo(() => arrangeAt(model, tNow, [0, Math.max(endMs, 1)]), [model, bucket, endMs]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = arr.placed.map((p: Placed) => ({
      pid: p.node.pid,
      alias: `P${p.node.n}`,
      canonical: p.node.canonical,
      type: p.node.type,
      stratum: p.node.stratum,
      firstMs: p.node.firstMs,
      tone: p.tone,
      a: p.latest.a,
      b: p.latest.b,
      crux: arr.crux?.pid === p.node.pid,
    }));
    for (const u of model.unheldNodes) {
      if (u.atMs > tNow) continue;
      out.push({ pid: u.pid, alias: '', canonical: u.canonical, type: u.type, stratum: u.stratum, firstMs: u.atMs, tone: 'unheld', crux: false });
    }
    return out;
  }, [arr, model, tNow]);

  const counts: Record<Filter, number> = {
    all: rows.filter((r) => r.tone !== 'unheld').length,
    disputed: rows.filter((r) => r.tone === 'disputed').length,
    shared: rows.filter((r) => r.tone === 'shared').length,
    a: rows.filter((r) => r.tone === 'a').length,
    b: rows.filter((r) => r.tone === 'b').length,
    unheld: rows.filter((r) => r.tone === 'unheld').length,
  };
  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) => {
    if (filter === 'all' ? r.tone === 'unheld' : filter !== r.tone) return false;
    return !needle || r.canonical.toLowerCase().includes(needle);
  });

  const [sa, sb] = meta.sides;
  const single = !sb;
  const FILTERS: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    ...(single
      ? []
      : ([
          { id: 'disputed', label: 'Disputed' },
          { id: 'shared', label: 'Shared' },
          { id: 'a', label: `${sa?.displayName ?? 'A'} only` },
          { id: 'b', label: `${sb?.displayName ?? 'B'} only` },
        ] as { id: Filter; label: string }[])),
    { id: 'unheld', label: 'No debater stance' },
  ];

  const listRef = useRef<HTMLDivElement>(null);
  const moveFocus = (from: HTMLElement, dir: 1 | -1) => {
    const all = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('button[data-row]') ?? [])];
    const i = all.indexOf(from as HTMLButtonElement);
    all[i + dir]?.focus();
  };

  const selHg = selected?.startsWith('hg:') ? model.hgs.find((h) => `hg:${h.id}` === selected) ?? null : null;
  const selPid = selected && !selected.startsWith('hg:') ? selected : null;
  const grid = single ? 'grid-cols-[52px_minmax(0,1fr)_200px_60px]' : 'grid-cols-[52px_minmax(0,1fr)_190px_190px_60px]';

  return (
    <main className="flex h-dvh flex-col bg-field text-ink">
      <SessionBar meta={meta} current="positions" status={data.status} query={ph.query}>
        <span className="font-mono text-ink-2 tabular">
          {ph.t === null && !meta.ended ? 'Live' : 'Replay'} / {clock(tNow)}
        </span>
      </SessionBar>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px]">
        <section className="flex min-h-0 flex-col" aria-label="Positions">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-border px-5 py-3 md:px-6">
            <div role="group" aria-label="Filter" className="flex flex-wrap gap-1">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={filter === f.id}
                  onClick={() => setFilter(f.id)}
                  className={`h-8 rounded-[3px] px-2.5 text-[13px] ${filter === f.id ? 'bg-field-deep text-ink' : 'text-ink-3 hover:text-ink'}`}
                >
                  {f.label} <span className="font-mono text-[11px] text-ink-3 tabular">{counts[f.id]}</span>
                </button>
              ))}
            </div>
            <label className="ml-auto flex items-center gap-2">
              <span className="sr-only">Search propositions</span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search propositions"
                className="h-8 w-[220px] rounded-[3px] border border-border bg-field px-2.5 text-[13px] text-ink placeholder:text-ink-3"
              />
            </label>
          </div>

          <div ref={listRef} className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
            <div className={`sticky top-0 z-10 grid ${grid} gap-4 border-b border-border bg-field px-5 py-2 text-[12px] text-ink-3 md:px-6`} aria-hidden>
              <span>Id</span>
              <span>Proposition</span>
              {sa ? <span style={{ color: VOICE_VAR[sa.voice] }}>{sa.displayName}</span> : <span />}
              {!single && sb ? <span style={{ color: VOICE_VAR[sb.voice] }}>{sb.displayName}</span> : null}
              <span className="text-right">First</span>
            </div>
            {shown.length === 0 ? (
              <p className="px-6 py-8 text-[14px] text-ink-3">{rows.length ? 'Nothing matches at this moment.' : 'No propositions mapped by this moment.'}</p>
            ) : null}
            {STRATA.map((st) => {
              const group = shown.filter((r) => r.stratum === st).sort((a, b) => a.firstMs - b.firstMs);
              if (!group.length) return null;
              return (
                <section key={st} aria-label={STRATUM_LABEL[st]}>
                  <h2 className="flex items-baseline gap-3 border-b border-border px-5 pb-2 pt-6 md:px-6">
                    <span className="text-[15px] font-medium text-ink">{STRATUM_LABEL[st]}</span>
                    <span className="text-[13px] text-ink-3">{STRATUM_GLOSS[st]}</span>
                    <span className="ml-auto font-mono text-[12px] text-ink-3 tabular">{group.length}</span>
                  </h2>
                  <ul>
                    {group.map((r) => {
                      const on = selected === r.pid;
                      return (
                        <li key={r.pid}>
                          <button
                            type="button"
                            data-row
                            aria-pressed={on}
                            onClick={() => select(on ? null : r.pid)}
                            onKeyDown={(e) => {
                              if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
                              e.preventDefault();
                              moveFocus(e.currentTarget, e.key === 'ArrowDown' ? 1 : -1);
                            }}
                            className={`grid w-full ${grid} items-start gap-4 border-b border-l-2 border-b-border px-5 py-3 text-left md:px-6 ${on ? 'border-l-focus bg-surface' : 'border-l-transparent hover:bg-field-subtle'}`}
                          >
                            <span className="pt-0.5 font-mono text-[12px] text-ink-3">{r.alias}</span>
                            <span className="min-w-0">
                              <span className="block text-[15px] leading-[1.45] text-ink">{r.canonical}</span>
                              <span className="mt-1 flex flex-wrap gap-x-3 text-[12px] text-ink-3">
                                <span>{r.type}</span>
                                {r.tone === 'shared' ? <span className="text-convergence">Shared</span> : null}
                                {r.tone === 'disputed' ? <span className="text-ink-2">Disputed</span> : null}
                                {r.crux ? <span className="font-medium uppercase tracking-[0.12em] text-ink">Crux · candidate</span> : null}
                              </span>
                            </span>
                            <StanceCell st={r.a} meta={meta} />
                            {!single ? <StanceCell st={r.b} meta={meta} /> : null}
                            <span className="pt-0.5 text-right font-mono text-[12px] text-ink-3 tabular">{clock(r.firstMs)}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        </section>

        <aside className="scroll-quiet min-h-0 overflow-y-auto border-t border-border px-6 py-6 lg:border-l lg:border-t-0" aria-label="Inspector">
          {selPid ? (
            <PropositionInspector
              s={live}
              meta={meta}
              pid={selPid}
              alias={model.byId.get(selPid) ? `P${model.byId.get(selPid)!.n}` : undefined}
              tNow={tNow}
              crux={arr.crux?.pid === selPid ? { body: arr.crux.body, tMs: arr.crux.tMs } : null}
              query={(sel) => `?t=${Math.round(tNow / 1000)}&sel=${encodeURIComponent(sel)}`}
              from="positions"
              onSelect={select}
              onSeek={(ms) => {
                ph.pause();
                ph.setT(ms);
              }}
              onClose={() => select(null)}
            />
          ) : selHg ? (
            <HigherGroundInspector s={live} meta={meta} body={selHg.body} tMs={selHg.tMs} onSelect={select} onClose={() => select(null)} />
          ) : (
            <div className="space-y-4">
              <p className="label-caps text-ink-3">At {clock(tNow)}</p>
              <p className="text-[14px] leading-relaxed text-ink-3">Select a proposition to inspect its sources. Arrow keys move between rows.</p>
              {arr.hg ? (
                <div className="border-t border-border pt-4">
                  <p className="label-caps text-convergence">Higher ground · Candidate</p>
                  <button type="button" onClick={() => select(`hg:${arr.hg!.id}`)} className="mt-2 block text-left text-[17px] leading-snug text-ink hover:underline hover:decoration-border-2 hover:underline-offset-4">
                    {arr.hg.body.text}
                  </button>
                  <p className="mt-1 text-[13px] text-ink-3">Not confirmed by participants.</p>
                </div>
              ) : null}
            </div>
          )}
        </aside>
      </div>

      <TimeDock rounds={model.rounds} bands={model.bands} ended={meta.ended} />
    </main>
  );
}

function StanceCell({ st, meta }: { st?: Stance; meta: SessionMeta }) {
  if (!st) return <span className="pt-0.5 text-[13px] text-ink-ghost">—</span>;
  const color = voiceColor(meta, st.participantKey);
  return (
    <span className="flex items-start gap-2 pt-0.5 text-[13px] leading-snug text-ink-2">
      <span className="pt-[3px]">
        <StanceGlyph attitude={st.attitude} color={color} />
      </span>
      <span>
        {ATTITUDE_LABEL[st.attitude]}
        <span className="text-ink-3"> · {st.strength}</span>
      </span>
    </span>
  );
}
