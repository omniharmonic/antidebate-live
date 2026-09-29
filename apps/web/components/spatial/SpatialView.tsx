'use client';

/**
 * Explore › Spatial (UX §6, DIRECTION §5): a three-dimensional map whose state
 * changes with time. Height is stratum, left–right is who holds a proposition,
 * depth is when it was first asserted. Propositions appear as the playhead
 * passes them; the layout is a deterministic function of the log.
 */
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { SessionBar } from '@/components/SessionBar';
import { TimeDock } from '@/components/explore/TimeDock';
import { HigherGroundInspector, PropositionInspector } from '@/components/explore/Inspector';
import { ATTITUDE_LABEL, VOICE_VAR, clock, personOf, type SessionMeta } from '@/lib/derive';
import { usePlayhead, useSession } from '@/lib/session-context';
import { GEOM, HG_Y, STRATA, STRATUM_GLOSS, STRATUM_LABEL, arrangeAt, buildSpatialModel, planeY, windowRange, type Arrangement, type SRel, type SpatialModel } from '@/lib/spatial-model';
import type { LabelSpec, SceneApi } from './Scene';

const Scene = dynamic(() => import('./Scene'), {
  ssr: false,
  loading: () => <p className="absolute inset-0 grid place-items-center text-[14px] text-ink-3">Loading the 3D map.</p>,
});

function subscribeReducedMotion(cb: () => void) {
  const m = window.matchMedia('(prefers-reduced-motion: reduce)');
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
}
function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false,
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;
}

export function Spatial() {
  const data = useSession();
  const { live, meta, events, version } = data;
  const ph = usePlayhead();
  const { tNow, endMs, selected, select } = ph;
  const reducedMotion = useReducedMotion();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const model = useMemo(() => buildSpatialModel(live, events, meta, endMs), [version, endMs, meta]);
  const bucket = Math.floor(tNow / 200);
  const range = useMemo(() => windowRange(model, tNow, ph.window), [model, ph.window, ph.window === 'full' ? 0 : bucket]); // eslint-disable-line react-hooks/exhaustive-deps
  const arrangement = useMemo(() => arrangeAt(model, tNow, range), [model, bucket, range]); // eslint-disable-line react-hooks/exhaustive-deps

  const [hovered, setHovered] = useState<string | null>(null);
  const [present, setPresent] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const api = useRef<SceneApi | null>(null);
  const labelEls = useRef(new Map<string, HTMLElement>());

  const selHg = selected?.startsWith('hg:') ? model.hgs.find((h) => `hg:${h.id}` === selected) ?? null : null;
  const selPid = selected && !selected.startsWith('hg:') ? selected : null;

  const { neighborhood, selectedRels } = useMemo(() => {
    if (!selected) return { neighborhood: null as Set<string> | null, selectedRels: [] as SRel[] };
    const n = new Set<string>([selected]);
    const rels: SRel[] = [];
    if (selHg) {
      for (const ids of Object.values(selHg.body.derivation)) ids.forEach((id) => n.add(id));
    } else if (arrangement.byId.has(selected)) {
      for (const r of model.relations) {
        if (r.atMs > tNow) continue;
        if (r.from !== selected && r.to !== selected) continue;
        const other = r.from === selected ? r.to : r.from;
        if (!arrangement.byId.has(other)) continue;
        n.add(other);
        rels.push(r);
      }
    }
    return { neighborhood: n, selectedRels: rels };
  }, [selected, selHg, arrangement, model, tNow]);

  const onSelect = useCallback(
    (id: string) => {
      select(id);
    },
    [select],
  );

  // keyboard: [ and ] step through propositions in order of first assertion; F centres the selection
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey) return;
      if (e.key === '[' || e.key === ']') {
        const list = arrangement.placed;
        if (!list.length) return;
        const i = selPid ? list.findIndex((p) => p.node.pid === selPid) : -1;
        const j = e.key === ']' ? (i + 1) % list.length : (i <= 0 ? list.length : i) - 1;
        select(list[j]!.node.pid);
      } else if (e.key === 'f' || e.key === 'F') {
        if (selected) api.current?.focus(selected);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [arrangement, selPid, selected, select]);

  const labels = useLabels(model, arrangement, meta, selected, hovered, selectedRels);
  const [sa, sb] = meta.sides;
  const single = !sb;

  return (
    <main className="flex h-dvh flex-col bg-field text-ink">
      <SessionBar meta={meta} current="spatial" status={data.status} query={ph.query}>
        <span className="hidden text-ink-3 md:inline tabular">
          <span className="text-ink-2">{arrangement.counts.propositions}</span> propositions · <span className="text-ink-2">{arrangement.counts.disputed}</span> disputed ·{' '}
          <span className="text-convergence">{arrangement.counts.shared}</span> shared
        </span>
        <span className="font-mono text-ink-2 tabular">
          {ph.t === null && !meta.ended ? 'Live' : 'Replay'} / {clock(tNow)}
        </span>
      </SessionBar>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px]">
        <section className="flex min-h-[420px] flex-col" aria-label="Spatial map">
          <div className="relative min-h-0 flex-1 overflow-hidden">
          <div
            className="absolute inset-0"
            tabIndex={0}
            role="application"
            aria-roledescription="3D map"
            aria-label={`Spatial map of ${arrangement.counts.propositions} propositions at ${clock(tNow)}. Height is stratum, left to right is who holds it, depth is time first asserted. Press ] or [ to step through propositions, F to centre the selection. The Positions lens lists the same content.`}
          >
            {model.nodes.length > 0 ? (
              <Scene
                model={model}
                arrangement={arrangement}
                range={range}
                selected={selected}
                hovered={hovered}
                neighborhood={neighborhood}
                selectedRels={selectedRels}
                labels={labels.specs}
                labelEls={labelEls}
                api={api}
                present={present}
                reducedMotion={reducedMotion}
                onHover={setHovered}
                onSelect={onSelect}
              />
            ) : (
              <p className="absolute inset-0 grid place-items-center px-8 text-center text-[15px] text-ink-3">
                {events.length === 0 && data.status !== 'open' ? 'Loading the session.' : live.utteranceOrder.length ? 'Transcript arriving. No propositions mapped yet.' : 'Waiting for the first utterance.'}
              </p>
            )}
          </div>

          {/* labels projected from the scene */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
            {labels.nodes.map(({ key, node }) => (
              <div
                key={key}
                ref={(el) => {
                  if (el) labelEls.current.set(key, el);
                  else labelEls.current.delete(key);
                }}
                className="absolute left-0 top-0 will-change-transform"
                style={{ visibility: 'hidden' }}
              >
                {node}
              </div>
            ))}
          </div>

          {keyOpen ? (
            <div className="absolute bottom-3 left-4">
              <Key meta={meta} model={model} single={single} />
            </div>
          ) : null}
          </div>

          {/* legend and camera */}
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5">
            <div className="max-w-[760px]">
              <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-3">
                <span>
                  <span className="text-ink-2">Height</span> stratum
                </span>
                <span>
                  <span className="text-ink-2">Left–right</span>{' '}
                  {single ? 'layout spacing only (one speaker)' : `who holds it: ${sa?.displayName ?? 'A'} left, ${sb?.displayName ?? 'B'} right, both centre`}
                </span>
                <span>
                  <span className="text-ink-2">Depth</span> time first asserted, nearest latest
                </span>
                <button type="button" onClick={() => setKeyOpen((v) => !v)} aria-expanded={keyOpen} className="text-ink-2 underline decoration-border-2 underline-offset-4 hover:text-ink">
                  {keyOpen ? 'Hide key' : 'Key'}
                </button>
              </p>
            </div>
            <div className="flex gap-2">
              {selected ? (
                <button type="button" onClick={() => api.current?.focus(selected)} className="h-9 rounded-[3px] border border-border bg-field px-3 text-[13px] text-ink-2 hover:text-ink">
                  Centre selection
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setPresent((v) => !v)}
                aria-pressed={present}
                disabled={reducedMotion}
                title={reducedMotion ? 'Off while reduced motion is requested' : 'Slow orbit for presenting. Press again to pause.'}
                className={`h-9 rounded-[3px] border px-3 text-[13px] disabled:opacity-40 ${present ? 'border-border-2 bg-field-deep text-ink' : 'border-border bg-field text-ink-2 hover:text-ink'}`}
              >
                {present ? 'Pause orbit' : 'Present'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPresent(false);
                  api.current?.reset();
                }}
                className="h-9 rounded-[3px] border border-border bg-field px-3 text-[13px] text-ink-2 hover:text-ink"
              >
                Reset view
              </button>
            </div>
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
              crux={arrangement.crux?.pid === selPid ? { body: arrangement.crux.body, tMs: arrangement.crux.tMs } : null}
              query={(sel) => `?t=${Math.round(tNow / 1000)}&sel=${encodeURIComponent(sel)}`}
              from="spatial"
              onSelect={onSelect}
              onSeek={(ms) => {
                ph.pause();
                ph.setT(ms);
              }}
              onClose={() => select(null)}
            />
          ) : selHg ? (
            <HigherGroundInspector s={live} meta={meta} body={selHg.body} tMs={selHg.tMs} onSelect={onSelect} onClose={() => select(null)} />
          ) : (
            <Moment arrangement={arrangement} meta={meta} tNow={tNow} onSelect={onSelect} model={model} live={live} />
          )}
        </aside>
      </div>

      <TimeDock rounds={model.rounds} bands={model.bands} ended={meta.ended} windowControl />
    </main>
  );
}

/* ---------- labels ---------- */

function useLabels(model: SpatialModel, arr: Arrangement, meta: SessionMeta, selected: string | null, hovered: string | null, rels: SRel[]) {
  const W = GEOM.halfWidth + 0.8;
  const front = Math.min(arr.zTo, GEOM.depth / 2) + 0.6;
  const [sa, sb] = meta.sides;
  const specs: LabelSpec[] = [];
  const nodes: { key: string; node: React.ReactNode }[] = [];
  const add = (spec: LabelSpec, node: React.ReactNode) => {
    specs.push(spec);
    nodes.push({ key: spec.key, node });
  };

  for (const st of STRATA) {
    add(
      { key: `st:${st}`, anchor: { pos: [-W - 0.4, planeY(st), front] } },
      <div className="-translate-x-full -translate-y-1/2 pr-3 text-right">
        <p className="text-[14px] font-medium leading-5 text-ink">{STRATUM_LABEL[st]}</p>
        <p className="whitespace-nowrap text-[12px] leading-4 text-ink-3">{STRATUM_GLOSS[st]}</p>
      </div>,
    );
  }
  if (model.hgs.length)
    add(
      { key: 'hglevel', anchor: { pos: [-W - 0.4, HG_Y, front] } },
      <div className="-translate-x-full -translate-y-1/2 pr-3 text-right">
        <p className="whitespace-nowrap text-[14px] font-medium leading-5 text-convergence">Higher ground</p>
        <p className="whitespace-nowrap text-[12px] leading-4 text-ink-3">Candidates, not agreement</p>
      </div>,
    );
  if (sa && sb) {
    add(
      { key: 'side:a', anchor: { pos: [-(GEOM.outer[0] + GEOM.outer[1]) / 2, -1, front] } },
      <p className="-translate-x-1/2 whitespace-nowrap pt-1 text-[13px]" style={{ color: VOICE_VAR[sa.voice] }}>
        ← {sa.displayName} only
      </p>,
    );
    add(
      { key: 'side:b', anchor: { pos: [(GEOM.outer[0] + GEOM.outer[1]) / 2, -1, front] } },
      <p className="-translate-x-1/2 whitespace-nowrap pt-1 text-[13px]" style={{ color: VOICE_VAR[sb.voice] }}>
        {sb.displayName} only →
      </p>,
    );
    add(
      { key: 'side:both', anchor: { pos: [0, -1, front] } },
      <p className="-translate-x-1/2 whitespace-nowrap pt-1 text-[13px] text-ink-2">Both</p>,
    );
  }
  add(
    { key: 'slice', anchor: { pos: [W, planeY('praxis') + 0.8, Math.min(arr.zTo, GEOM.depth / 2)] } },
    <p className="-translate-y-full whitespace-nowrap pb-1 pl-1 font-mono text-[12px] text-ink-2">now</p>,
  );

  const pidLabel = (pid: string) => {
    const n = model.byId.get(pid);
    return n ? `P${n.n}` : '';
  };

  const crux = arr.crux;
  if (crux && crux.pid !== selected && crux.pid !== hovered) {
    add(
      { key: 'crux', anchor: { id: crux.pid } },
      <div className="max-w-[300px] -translate-y-1/2 translate-x-[22px] border-l border-ink bg-field py-1 pl-2.5 pr-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink">Crux · candidate</p>
        <p className="text-[13px] leading-[1.35] text-ink-2">{truncate(arr.byId.get(crux.pid)?.node.canonical ?? crux.body.statement, 90)}</p>
      </div>,
    );
  }
  const hg = arr.hg;
  if (hg && `hg:${hg.id}` !== selected && `hg:${hg.id}` !== hovered) {
    add(
      { key: 'hg', anchor: { id: `hg:${hg.id}` } },
      <div className="w-[300px] -translate-y-full translate-x-[20px] border-l border-convergence bg-field py-1 pl-2.5 pr-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-convergence">Higher ground · Candidate</p>
        <p className="text-[13px] leading-[1.35] text-ink-2">{truncate(hg.body.text, 90)}</p>
      </div>,
    );
  }
  for (const id of [selected, hovered]) {
    if (!id || (id === hovered && id === selected && specs.some((s) => s.key === 'sel'))) continue;
    const key = id === selected ? 'sel' : 'hov';
    if (id.startsWith('hg:')) {
      const h = arr.hgs.find((x) => `hg:${x.id}` === id);
      if (!h) continue;
      add(
        { key, anchor: { id } },
        <div className="max-w-[320px] -translate-y-1/2 translate-x-[22px] border border-border bg-surface px-3 py-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-convergence">Higher ground · Candidate</p>
          <p className="mt-0.5 text-[13px] leading-[1.4] text-ink">{truncate(h.body.text, 160)}</p>
        </div>,
      );
      continue;
    }
    const p = arr.byId.get(id);
    if (!p) continue;
    const holders = [p.latest.a, p.latest.b].filter(Boolean).map((st) => `${personOf(meta, st!.participantKey).displayName.split(' ')[0]} ${ATTITUDE_LABEL[st!.attitude]}`);
    add(
      { key, anchor: { id } },
      <div className="max-w-[340px] -translate-y-1/2 translate-x-[22px] border border-border bg-surface px-3 py-2">
        <p className="font-mono text-[11px] text-ink-3">
          {pidLabel(id)} · {STRATUM_LABEL[p.node.stratum]}
          {crux?.pid === id ? <span className="ml-2 font-sans font-medium uppercase tracking-[0.12em] text-ink">Crux · candidate</span> : null}
        </p>
        <p className="mt-0.5 text-[13px] leading-[1.4] text-ink">{truncate(p.node.canonical, 180)}</p>
        <p className="mt-1 text-[12px] text-ink-3">{holders.join(' · ')}</p>
      </div>,
    );
  }
  for (const r of rels) {
    add(
      { key: `rel:${r.id}`, anchor: { mid: [r.from, r.to] } },
      <p className="-translate-x-1/2 -translate-y-1/2 whitespace-nowrap bg-field px-1 text-[11px] text-ink-2">
        {r.type}
        {r.inferred ? ' · inferred' : ''}
      </p>,
    );
  }
  return { specs, nodes };
}

/* ---------- key ---------- */

function Key({ meta, model, single }: { meta: SessionMeta; model: SpatialModel; single: boolean }) {
  const [sa, sb] = meta.sides;
  const row = 'flex items-center gap-2.5';
  return (
    <div className="max-w-[640px] border border-border bg-field px-4 py-3 text-[12px] leading-[1.5] text-ink-2">
      <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {sa ? (
          <span className={row}>
            <Dot color={VOICE_VAR[sa.voice]} /> {single ? `Held by ${sa.displayName}` : `Held only by ${sa.displayName}`}
          </span>
        ) : null}
        {sb ? (
          <span className={row}>
            <Dot color={VOICE_VAR[sb.voice]} /> Held only by {sb.displayName}
          </span>
        ) : null}
        <span className={row}>
          <Ring color="var(--ink-2)" /> Rejected or suspended by its only holder
        </span>
        {!single ? (
          <>
            <span className={row}>
              <Dot color="var(--convergence)" /> Shared: both accept, at least leaning
            </span>
            <span className={row}>
              <svg width="30" height="10" aria-hidden>
                <line x1="1" y1="5" x2="10" y2="5" stroke="var(--voice-a)" />
                <circle cx="15" cy="5" r="3.5" fill="var(--ink)" />
                <line x1="20" y1="5" x2="29" y2="5" stroke="var(--voice-b)" />
              </svg>
              Disputed: one accepts what the other rejects
            </span>
            <span className={row}>
              <svg width="22" height="10" aria-hidden>
                <line x1="1" y1="5" x2="21" y2="5" stroke="var(--border-2)" />
              </svg>
              Rebuts, undercuts or undermines across sides
            </span>
            <span className={row}>
              <svg width="22" height="10" aria-hidden>
                <line x1="1" y1="5" x2="21" y2="5" stroke="var(--convergence)" strokeOpacity="0.65" />
              </svg>
              Converging (inferred agreement between two claims)
            </span>
          </>
        ) : null}
        <span className={row}>
          <svg width="14" height="14" aria-hidden>
            <rect x="1.5" y="1.5" width="11" height="11" fill="none" stroke="var(--ink)" />
          </svg>
          Crux candidate at the playhead
        </span>
        <span className={row}>
          <Ring color="var(--convergence)" /> Higher-ground candidate (not agreement)
        </span>
        <span className={row}>
          <svg width="14" height="14" aria-hidden>
            <path d="M1 4V1h3M10 1h3v3M13 10v3h-3M4 13H1v-3" fill="none" stroke="var(--focus)" />
          </svg>
          Selected
        </span>
      </div>
      <p className="mt-2 text-ink-3">
        Distance within a side or along a plane is layout spacing, not a measure of disagreement. Propositions in a cross-side attack sit in the inner band of their side. A proposition moves to the centre when the second participant takes a stance on it.
        {model.unheld ? ` ${model.unheld} propositions carry no debater stance (for example steelman reports) and are listed in Positions.` : ''}
      </p>
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return (
    <svg width="12" height="12" aria-hidden className="shrink-0">
      <circle cx="6" cy="6" r="4" fill={color} />
    </svg>
  );
}
function Ring({ color }: { color: string }) {
  return (
    <svg width="12" height="12" aria-hidden className="shrink-0">
      <circle cx="6" cy="6" r="4" fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

/* ---------- inspector with nothing selected ---------- */

function Moment({ arrangement, meta, tNow, onSelect, model, live }: { arrangement: Arrangement; meta: SessionMeta; tNow: number; onSelect: (id: string) => void; model: SpatialModel; live: import('@adl/core').SessionState }) {
  const round = [...model.rounds].reverse().find((r) => r.startMs <= tNow);
  const crux = arrangement.crux;
  const hg = arrangement.hg;
  const recent = [...arrangement.placed].sort((a, b) => b.node.firstMs - a.node.firstMs).slice(0, 4);
  return (
    <div className="space-y-6">
      <div>
        <p className="label-caps text-ink-3">At {clock(tNow)}</p>
        <p className="mt-1 text-[15px] text-ink">{round?.name ?? 'No round marked'}</p>
        <p className="mt-3 text-[14px] leading-relaxed text-ink-3">Select a proposition to inspect its sources.</p>
      </div>
      <div className="border-t border-border pt-4">
        <p className="label-caps text-ink-3">Crux · candidate</p>
        {crux ? (
          <button type="button" onClick={() => onSelect(crux.pid)} className="mt-2 block text-left text-[17px] leading-snug text-ink hover:underline hover:decoration-border-2 hover:underline-offset-4">
            {live.propositions.get(crux.pid)?.value.canonical ?? crux.body.statement}
          </button>
        ) : (
          <p className="mt-2 text-[14px] text-ink-3">No crux identified by this moment.</p>
        )}
      </div>
      <div className="border-t border-border pt-4">
        <p className="label-caps text-convergence">Higher ground · Candidate</p>
        {hg ? (
          <>
            <button type="button" onClick={() => onSelect(`hg:${hg.id}`)} className="mt-2 block text-left text-[17px] leading-snug text-ink hover:underline hover:decoration-border-2 hover:underline-offset-4">
              {hg.body.text}
            </button>
            <p className="mt-1 text-[13px] text-ink-3">Not confirmed by participants.</p>
          </>
        ) : (
          <p className="mt-2 text-[14px] text-ink-3">No higher-ground candidate by this moment.</p>
        )}
      </div>
      {recent.length ? (
        <div className="border-t border-border pt-4">
          <p className="label-caps text-ink-3">Most recent</p>
          <ul className="mt-2 space-y-2.5">
            {recent.map((p) => {
              const holder = p.latest.b && !p.latest.a ? p.latest.b : p.latest.a;
              return (
                <li key={p.node.pid}>
                  <button type="button" onClick={() => onSelect(p.node.pid)} className="block text-left text-[14px] leading-snug text-ink-2 hover:text-ink">
                    <span className="mr-2 font-mono text-[11px] text-ink-3">{clock(p.node.firstMs)}</span>
                    {p.node.canonical}
                    {holder ? <span className="ml-1 text-ink-3">({personOf(meta, holder.participantKey).displayName.split(' ')[0]})</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
