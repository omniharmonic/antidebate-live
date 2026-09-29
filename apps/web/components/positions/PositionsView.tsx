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
import { EvidencePane } from '@/components/explore/EvidencePane';
import { TimeDock } from '@/components/explore/TimeDock';
import { HigherGroundInspector, PropositionInspector, StanceGlyph } from '@/components/explore/Inspector';
import { ATTITUDE_LABEL, VOICE_VAR, clock, voiceColor, type SessionMeta } from '@/lib/derive';
import { useStateAt } from '@/lib/use-session';
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
  const atT = useStateAt(data, ph.t);
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
  const grid = single ? 'positions-single' : 'positions-pair';

  return (
    <main className="session-screen flex h-dvh flex-col bg-field text-ink">
      <SessionBar meta={meta} current="positions" status={data.status} query={ph.query}>
        <span className="font-mono text-ink-2 tabular">
          {ph.t === null && !meta.ended ? 'Live' : 'Replay'} / {clock(tNow)}
        </span>
      </SessionBar>

      <div className="explore-workspace">
        <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Positions">
          <div className="positions-toolbar border-b border-border px-4 py-3 md:px-6">
            <label className="flex items-center gap-3 text-[13px] text-ink-3 sm:hidden">Show
              <select aria-label="Filter propositions" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="h-11 min-w-0 flex-1 rounded-[3px] border border-border bg-field px-3 text-ink">
                {FILTERS.map((f) => <option key={f.id} value={f.id}>{f.label} ({counts[f.id]})</option>)}
              </select>
            </label>
            <div role="group" aria-label="Filter" className="positions-filters hidden gap-1 overflow-x-auto sm:flex">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={filter === f.id}
                  onClick={() => setFilter(f.id)}
                  className={`h-11 shrink-0 whitespace-nowrap rounded-[3px] px-2.5 text-[13px] ${filter === f.id ? 'bg-field-deep text-ink' : 'text-ink-3 hover:text-ink'}`}
                >
                  {f.label} <span className="font-mono text-[11px] text-ink-3 tabular">{counts[f.id]}</span>
                </button>
              ))}
            </div>
            <label className="positions-search flex items-center gap-2">
              <span className="sr-only">Search propositions</span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search propositions"
                type="search" className="h-11 w-full min-w-0 rounded-[3px] border border-border bg-field px-2.5 text-[13px] text-ink placeholder:text-ink-3"
              />
            </label>
          </div>

          <div ref={listRef} className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
            <div className={`positions-columns sticky top-0 z-10 ${grid} gap-4 border-b border-border bg-field px-5 py-2 text-[12px] text-ink-3 md:px-6`} aria-hidden>
              <span>Id</span>
              <span>Proposition</span>
              {sa ? <span style={{ color: VOICE_VAR[sa.voice] }}>{sa.displayName}</span> : <span />}
              {!single && sb ? <span style={{ color: VOICE_VAR[sb.voice] }}>{sb.displayName}</span> : null}
              <span className="text-right">First</span>
            </div>
            {shown.length === 0 ? (
              <div className="px-6 py-8 text-[14px] text-ink-3"><p>{rows.length ? 'No propositions match these filters.' : 'No propositions mapped by this moment.'}</p>{rows.length > 0 ? <button type="button" className="control-button mt-4" onClick={() => { setQ(''); setFilter('all'); }}>Clear filters</button> : null}</div>
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
                            className={`position-row w-full ${grid} items-start gap-4 border-b border-l-2 border-b-border px-5 py-3 text-left md:px-6 ${on ? 'border-l-focus bg-surface' : 'border-l-transparent hover:bg-field-subtle'}`}
                          >
                            <span className="position-alias pt-0.5 font-mono text-[12px] text-ink-3">{r.alias}</span>
                            <span className="position-claim min-w-0">
                              <span className="block text-[15px] leading-[1.45] text-ink">{r.canonical}</span>
                              <span className="mt-1 flex flex-wrap gap-x-3 text-[12px] text-ink-3">
                                <span>{r.type}</span>
                                {r.tone === 'shared' ? <span className="text-convergence">Shared</span> : null}
                                {r.tone === 'disputed' ? <span className="text-ink-2">Disputed</span> : null}
                                {r.crux ? <span className="font-medium uppercase tracking-[0.12em] text-ink">Crux · candidate</span> : null}
                              </span>
                            </span>
                            <StanceCell st={r.a} meta={meta} name={sa?.displayName} />
                            {!single ? <StanceCell st={r.b} meta={meta} name={sb?.displayName} /> : null}
                            <span className="position-time pt-0.5 text-right font-mono text-[12px] text-ink-3 tabular">{clock(r.firstMs)}</span>
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

        <EvidencePane selected={selected} onClose={() => select(null)}>
          {selPid ? (
            <PropositionInspector
              s={atT}
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
            <HigherGroundInspector s={atT} meta={meta} body={selHg.body} tMs={selHg.tMs} onSelect={select} onClose={() => select(null)} />
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
        </EvidencePane>
      </div>

      <TimeDock rounds={model.rounds} bands={model.bands} ended={meta.ended} />
    </main>
  );
}

function StanceCell({ st, meta, name }: { st?: Stance; meta: SessionMeta; name?: string }) {
  if (!st) return <span className="position-stance text-[13px] text-ink-3"><span className="position-person">{name}</span>No stance</span>;
  const color = voiceColor(meta, st.participantKey);
  return (
    <span className="position-stance flex items-start gap-2 pt-0.5 text-[13px] leading-snug text-ink-2">
      <span className="pt-[3px]">
        <StanceGlyph attitude={st.attitude} color={color} />
      </span>
      <span>
        <span className="position-person" style={{ color }}>{name}</span>
        {ATTITUDE_LABEL[st.attitude]}
        <span className="text-ink-3"> · {st.strength}</span>
      </span>
    </span>
  );
}
