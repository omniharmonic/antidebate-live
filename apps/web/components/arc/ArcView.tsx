'use client';

/**
 * The arc (R0_DEMO): the Anti-Debate pattern over the whole conversation.
 * Time runs left to right. One lane per side; distance from the centre is
 * stratum depth, so the deeper a commitment, the further out it sits. Where the
 * two sides take opposite stances, their colours meet across the centre. Shared
 * ground and higher-ground cards collect in the centre channel. A playhead
 * replays it at 1×, 4× or 16× and drives the side panel.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EvidencePane } from '@/components/explore/EvidencePane';
import { TimeDock } from '@/components/explore/TimeDock';
import { PropositionInspector } from '@/components/explore/Inspector';
import type { SessionState } from '@adl/core';
import { STRATUM_DEPTH, type Stratum } from '@adl/ontology';
import { SessionBar } from '@/components/SessionBar';
import { CruxBody, HigherGroundBody, PromptBody, SharedBody } from '@/components/cockpit/CockpitView';
import { buildArcModel, countsAt, type ArcMark } from '@/lib/arc-model';
import { ATTITUDE_LABEL, VOICE_VAR, clock, currentCard, personOf, voiceColor, type SessionMeta } from '@/lib/derive';
import { useStateAt } from '@/lib/use-session';
import { usePlayhead, useSession } from '@/lib/session-context';
import { STRATUM_LABEL } from '@/lib/spatial-model';
import type { CruxCard, HigherGroundCard } from '@adl/ontology';

/* ---------- geometry ---------- */

const ML = 168; // left margin: names + stratum labels
const MR = 28;
const TOP = 58; // phase + round header
const ROW = 22; // one stratum row
const LANE = ROW * 5;
const CHANNEL = 92;
const LANE_A = TOP + 8;
const CH_TOP = LANE_A + LANE;
const CH_MID = CH_TOP + CHANNEL / 2;
const LANE_B = CH_TOP + CHANNEL;
const SPEAK = LANE_B + LANE + 18;
const AXIS = SPEAK + 26;
const GAP_TOP = AXIS + 40;
const GAP_H = 64;
const HEIGHT = GAP_TOP + GAP_H + 16;

const STRATA: Stratum[] = ['praxis', 'empirical', 'axiology', 'epistemology', 'ontology'];
const R_BY_STRENGTH: Record<ArcMark['strength'], number> = { tentative: 3, leaning: 4, confident: 5, certain: 6 };

function rowY(lane: 0 | 1, stratum: Stratum): number {
  const d = STRATUM_DEPTH[stratum];
  return lane === 0 ? CH_TOP - (d + 0.5) * ROW : LANE_B + (d + 0.5) * ROW;
}

interface Placed extends ArcMark {
  x: number;
  y: number;
  r: number;
}

/** Keep marks from sitting on top of each other: nudge within the row, then into a sub-row. */
function place(marks: ArcMark[], xs: (t: number) => number): Placed[] {
  const lastX = new Map<string, number[]>();
  const SUB = [0, -6, 6];
  const out: Placed[] = [];
  for (const m of [...marks].sort((a, b) => a.tMs - b.tMs)) {
    const r = R_BY_STRENGTH[m.strength];
    const key = `${m.lane}:${m.stratum}`;
    const lasts = lastX.get(key) ?? SUB.map(() => -Infinity);
    const x0 = xs(m.tMs);
    let best = 0;
    let bestX = Infinity;
    for (let i = 0; i < SUB.length; i++) {
      const x = Math.max(x0, lasts[i]! + r + 3.5);
      if (x - x0 < 2) {
        best = i;
        bestX = x;
        break;
      }
      if (x < bestX) {
        best = i;
        bestX = x;
      }
    }
    lasts[best] = bestX + r;
    lastX.set(key, lasts);
    out.push({ ...m, x: bestX, y: rowY(m.lane, m.stratum) + SUB[best]! * (m.lane === 0 ? 1 : -1), r });
  }
  return out;
}

function niceStep(spanMs: number, px: number): number {
  const target = spanMs / Math.max(1, px / 90);
  const steps = [15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000];
  return steps.find((s) => s >= target) ?? 3_600_000;
}

/* ---------- component ---------- */

export function Arc({ sessionId }: { sessionId: string }) {
  void sessionId;
  const data = useSession();
  const { live, meta, events, version } = data;
  const ph = usePlayhead();
  const { t, tNow, endMs, selected } = ph;
  const setSelected = ph.select;
  const setT = ph.setT;
  const [hover, setHover] = useState<{ pid: string; x: number; y: number } | null>(null);
  const atT = useStateAt(data, t);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const model = useMemo(() => buildArcModel(live, events, meta, endMs), [version, endMs, meta]);

  /* width */
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(960);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(640, Math.floor(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const plotW = width - ML - MR;
  const xs = useCallback((ms: number) => ML + (Math.min(Math.max(ms, 0), endMs) / endMs) * plotW, [endMs, plotW]);
  const tOf = useCallback((x: number) => Math.round(((Math.min(Math.max(x, ML), ML + plotW) - ML) / plotW) * endMs), [endMs, plotW]);

  const placed = useMemo(() => place(model.marks, xs), [model.marks, xs]);
  const posOf = useMemo(() => {
    // latest mark per (participant, proposition), and any mark per proposition
    const byHolder = new Map<string, Placed>();
    const byPid = new Map<string, Placed[]>();
    for (const m of placed) {
      byHolder.set(`${m.participantKey}|${m.propositionId}`, m);
      byPid.set(m.propositionId, [...(byPid.get(m.propositionId) ?? []), m]);
    }
    return { byHolder, byPid };
  }, [placed]);

  /* scrubbing */
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const xFromEvent = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * width;
  };
  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'touch' || (e.target as Element).closest('.arc-mark')) return;
    dragging.current = true;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    ph.pause();
    setT(tOf(xFromEvent(e)));
  };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (dragging.current) setT(tOf(xFromEvent(e)));
  };
  const onUp = () => {
    dragging.current = false;
  };

  const future = (ms: number) => ms > tNow + 1;
  const px = xs(tNow);
  const counts = countsAt(model.series, tNow);
  const maxCount = Math.max(1, ...model.series.map((p) => Math.max(p.disputes, p.shared)));
  const tickStep = niceStep(endMs, plotW);
  const ticks: number[] = [];
  for (let v = 0; v <= endMs; v += tickStep) ticks.push(v);

  const focusPid = selected ?? hover?.pid ?? null;
  const sideA = meta.sides[0];
  const sideB = meta.sides[1];
  const hasContent = model.marks.length > 0;

  const stepPath = (key: 'disputes' | 'shared') => {
    const y = (n: number) => GAP_TOP + GAP_H - (n / maxCount) * (GAP_H - 8);
    let d = `M${ML},${y(0)}`;
    let prev = 0;
    for (const p of model.series) {
      const x = xs(p.tMs);
      d += `H${x}V${y(p[key])}`;
      prev = p[key];
    }
    d += `H${xs(endMs)}`;
    void prev;
    return d;
  };

  return (
    <main className="session-screen flex h-dvh flex-col bg-field text-ink">
      <SessionBar meta={meta} current="arc" status={data.status} query={ph.query}>
        <span className="hidden text-ink-3 md:inline tabular">
          <span className="text-ink-2">{counts.disputes}</span> open {counts.disputes === 1 ? 'disagreement' : 'disagreements'} · <span className="text-convergence">{counts.shared}</span> shared
        </span>
        <span className="font-mono text-ink-2 tabular">
          {t === null && !meta.ended ? 'Live' : 'Replay'} / {clock(tNow)}
        </span>
      </SessionBar>

      <div className="explore-workspace">
        <section className="timeline-viewport scroll-quiet min-h-0 min-w-0 flex-1 overflow-auto px-4 pb-6 pt-5 md:px-6">
          <p className="mb-3 text-[13px] text-ink-3 xl:hidden">Swipe across the timeline. Tap a point to read its sources.</p>
          <div ref={wrap} className="relative w-full select-none">
            <svg
              ref={svgRef}
              width={width}
              height={HEIGHT}
              viewBox={`0 0 ${width} ${HEIGHT}`}
              role="img"
              aria-label={`Arc of the conversation. ${model.marks.length} stances, ${model.disputes.length} disagreements, ${model.shared.length} shared propositions.`}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              style={{ touchAction: 'pan-x pan-y', cursor: 'crosshair', display: 'block' }}
            >
              {/* phase bands */}
              {model.bands.map((b, i) => {
                const x0 = xs(b.startMs);
                const x1 = xs(b.endMs);
                return (
                  <g key={`band${i}`}>
                    <rect x={x0} y={LANE_A} width={Math.max(0, x1 - x0)} height={LANE_B + LANE - LANE_A} fill={i % 2 === 0 ? 'var(--field-subtle)' : 'transparent'} />
                    <line x1={x0} x2={x0} y1={10} y2={LANE_B + LANE} stroke="var(--rule-strong)" />
                    {x1 - x0 > 90 ? (
                      <text x={x0 + 8} y={26} fontSize={14} fontWeight={500} fill="var(--ink)">
                        {b.name}
                      </text>
                    ) : null}
                  </g>
                );
              })}
              {/* rounds */}
              {model.rounds.map((r) => {
                const x0 = xs(r.startMs);
                const w = xs(r.endMs) - x0;
                return (
                  <g key={`r${r.roundId}${r.startMs}`}>
                    <line x1={x0} x2={x0} y1={36} y2={LANE_A} stroke="var(--rule-strong)" />
                    {w > 64 ? (
                      <text x={x0 + 6} y={50} fontSize={11.5} fill="var(--ink-3)" fontFamily="var(--font-text)">
                        {truncate(r.name, Math.floor((w - 10) / 6.2))}
                      </text>
                    ) : null}
                  </g>
                );
              })}

              {/* lane labels */}
              {[sideA, sideB].map((p, lane) =>
                p ? (
                  <g key={`lab${lane}`}>
                    <text x={0} y={(lane === 0 ? LANE_A : LANE_B) + LANE / 2 - 8} fontSize={14} fontWeight={500} fill={VOICE_VAR[p.voice]}>
                      {nameLines(p.displayName).map((line, i) => (
                        <tspan key={i} x={0} dy={i === 0 ? 0 : 17}>
                          {line}
                        </tspan>
                      ))}
                    </text>
                    {STRATA.map((st) => (
                      <text key={st} x={ML - 10} y={rowY(lane as 0 | 1, st) + 3.5} fontSize={10.5} textAnchor="end" fill="var(--ink-3)">
                        {st}
                      </text>
                    ))}
                  </g>
                ) : null,
              )}
              <text x={0} y={CH_MID + 4} fontSize={13} fill="var(--convergence)">
                Shared ground
              </text>

              {/* centre channel */}
              <rect x={ML} y={CH_TOP + 10} width={plotW} height={CHANNEL - 20} fill="var(--convergence-faint)" opacity={0.7} />
              <line x1={ML} x2={ML + plotW} y1={CH_MID} y2={CH_MID} stroke="var(--convergence-soft)" strokeDasharray="2 4" />

              {/* rebuttals across sides */}
              {model.relations.map((r) => {
                const a = posOf.byPid.get(r.fromPid)?.find((m) => m.lane === r.fromLane);
                const b = posOf.byPid.get(r.toPid)?.find((m) => m.lane === r.toLane);
                if (!a || !b) return null;
                const lit = focusPid === r.fromPid || focusPid === r.toPid;
                const midX = (a.x + b.x) / 2;
                return (
                  <path
                    key={r.id}
                    d={`M${a.x},${a.y} C${midX},${CH_MID} ${midX},${CH_MID} ${b.x},${b.y}`}
                    fill="none"
                    stroke={lit ? 'var(--ink)' : 'var(--ink-3)'}
                    strokeWidth={lit ? 1.5 : 1}
                    strokeDasharray={r.type === 'rebuts' ? undefined : '3 3'}
                    opacity={future(Math.max(a.tMs, b.tMs)) ? 0 : lit ? 0.9 : 0.14}
                    pointerEvents="none"
                  />
                );
              })}

              {/* disagreements: the two colours meet at the centre */}
              {model.sideKeys &&
                model.disputes.map((d) => {
                  const a = posOf.byHolder.get(`${model.sideKeys![0]}|${d.propositionId}`);
                  const b = posOf.byHolder.get(`${model.sideKeys![1]}|${d.propositionId}`);
                  if (!a || !b) return null;
                  const x = xs(d.startMs);
                  const open = d.endMs === null || d.endMs > tNow;
                  const op = future(d.startMs) ? 0 : open ? 0.95 : 0.3;
                  const lit = focusPid === d.propositionId;
                  return (
                    <g key={`d${d.propositionId}${d.startMs}`} opacity={op} pointerEvents="none">
                      <path d={`M${a.x},${a.y} Q${x},${a.y} ${x},${CH_MID}`} fill="none" stroke="var(--voice-a)" strokeWidth={lit ? 3 : 2} />
                      <path d={`M${b.x},${b.y} Q${x},${b.y} ${x},${CH_MID}`} fill="none" stroke="var(--voice-b)" strokeWidth={lit ? 3 : 2} />
                      <circle cx={x} cy={CH_MID} r={3} fill="var(--ink)" />
                    </g>
                  );
                })}

              {/* shared propositions */}
              {model.shared.map((sh) => {
                const x = xs(sh.startMs);
                const ends = posOf.byPid.get(sh.propositionId) ?? [];
                const lit = focusPid === sh.propositionId;
                const op = future(sh.startMs) ? 0 : sh.endMs !== null && sh.endMs <= tNow ? 0.35 : 1;
                return (
                  <g key={`s${sh.propositionId}${sh.startMs}`} opacity={op} visibility={op === 0 ? 'hidden' : undefined}>
                    {ends.map((m) => (
                      <line key={m.stanceId} x1={m.x} y1={m.y} x2={x} y2={CH_MID} stroke="var(--convergence)" strokeWidth={lit ? 1.5 : 0.75} opacity={lit ? 0.9 : 0.35} pointerEvents="none" />
                    ))}
                    <g
                      className="arc-mark"
                      tabIndex={0}
                      role="button"
                      aria-label={`Shared: ${live.propositions.get(sh.propositionId)?.value.canonical ?? sh.propositionId}`}
                      onClick={() => setSelected(sh.propositionId)}
                      onKeyDown={(e) => e.key === 'Enter' && setSelected(sh.propositionId)}
                      onPointerEnter={() => setHover({ pid: sh.propositionId, x, y: CH_MID })}
                      onPointerLeave={() => setHover(null)}
                    >
                      <rect className="arc-hit" x={x - 5.5} y={CH_MID - 5.5} width={11} height={11} transform={`rotate(45 ${x} ${CH_MID})`} fill="var(--convergence)" stroke="var(--field)" strokeWidth={1} />
                    </g>
                  </g>
                );
              })}

              {/* insight cards: crux (below the line), higher ground (above) */}
              {model.cards
                .filter((c) => c.kind === 'crux' || c.kind === 'higher_ground')
                .map((c) => {
                  const x = xs(c.tMs);
                  const body = c.tracked?.value.body as unknown as CruxCard | HigherGroundCard | undefined;
                  const op = future(c.tMs) ? 0 : 1;
                  if (c.kind === 'crux') {
                    const crux = body as CruxCard | undefined;
                    const pid = crux?.propositionId;
                    const endPids = [pid, ...(crux?.sides ?? []).map((sd) => sd.via?.propositionId)].filter((x): x is string => Boolean(x));
                    const ends = endPids.flatMap((id) => posOf.byPid.get(id) ?? []);
                    const y = CH_MID + 22;
                    return (
                      <g key={c.id} opacity={op} visibility={op === 0 ? 'hidden' : undefined}>
                        {ends.map((m) => (
                          <line key={m.stanceId} x1={m.x} y1={m.y} x2={x} y2={y} stroke={voiceColor(meta, m.participantKey)} strokeWidth={0.75} opacity={focusPid === pid ? 0.9 : 0.3} pointerEvents="none" />
                        ))}
                        <g
                          className="arc-mark"
                          tabIndex={0}
                          role="button"
                          aria-label={`Crux card at ${clock(c.tMs)}`}
                          onClick={() => pid && setSelected(pid)}
                          onKeyDown={(e) => e.key === 'Enter' && pid && setSelected(pid)}
                          onPointerEnter={() => pid && setHover({ pid, x, y })}
                          onPointerLeave={() => setHover(null)}
                        >
                          <rect className="arc-hit" x={x - 6} y={y - 6} width={12} height={12} transform={`rotate(45 ${x} ${y})`} fill="var(--field)" stroke="var(--ink)" strokeWidth={1.5} />
                        </g>
                      </g>
                    );
                  }
                  const hg = body as HigherGroundCard | undefined;
                  const y = CH_MID - 22;
                  const derived = hg ? Object.entries(hg.derivation).flatMap(([k, ids]) => ids.map((id) => posOf.byHolder.get(`${k}|${id}`)).filter((m): m is Placed => Boolean(m))) : [];
                  return (
                    <g key={c.id} opacity={op} visibility={op === 0 ? 'hidden' : undefined}>
                      {derived.map((m) => (
                        <line key={m.stanceId} x1={m.x} y1={m.y} x2={x} y2={y} stroke="var(--convergence)" strokeWidth={0.75} opacity={0.45} pointerEvents="none" />
                      ))}
                      <g className="arc-mark" tabIndex={0} role="img" aria-label={`Higher-ground card at ${clock(c.tMs)}: ${hg?.text ?? ''}`}>
                        <circle className="arc-hit" cx={x} cy={y} r={7} fill="var(--field)" stroke="var(--convergence)" strokeWidth={2} />
                        <circle cx={x} cy={y} r={2.5} fill="var(--convergence)" />
                        <title>{hg?.text}</title>
                      </g>
                    </g>
                  );
                })}

              {/* stance marks */}
              {placed.map((m) => {
                const color = voiceColor(meta, m.participantKey);
                const lit = focusPid === m.propositionId;
                const fill = m.attitude === 'rejects' ? 'var(--field)' : m.attitude === 'suspends' ? `url(#half-${m.lane})` : color;
                return (
                  <g
                    key={m.stanceId}
                    className="arc-mark"
                    opacity={future(m.tMs) ? 0 : 1}
                    visibility={future(m.tMs) ? 'hidden' : undefined}
                    tabIndex={0}
                    role="button"
                    aria-label={`${personOf(meta, m.participantKey).displayName} ${ATTITUDE_LABEL[m.attitude]}: ${live.propositions.get(m.propositionId)?.value.canonical ?? ''}`}
                    onClick={() => setSelected(m.propositionId)}
                    onKeyDown={(e) => e.key === 'Enter' && setSelected(m.propositionId)}
                    onPointerEnter={() => setHover({ pid: m.propositionId, x: m.x, y: m.y })}
                    onPointerLeave={() => setHover(null)}
                  >
                    <circle cx={m.x} cy={m.y} r={m.r + 5} fill="transparent" />
                    <circle
                      className="arc-hit"
                      cx={m.x}
                      cy={m.y}
                      r={m.r}
                      fill={fill}
                      stroke={lit ? 'var(--ink)' : color}
                      strokeWidth={lit ? 2 : 1.5}
                      strokeDasharray={m.source === 'implied_by_act' ? '2 1.5' : undefined}
                    />
                  </g>
                );
              })}
              <defs>
                {[0, 1].map((lane) => (
                  <linearGradient key={lane} id={`half-${lane}`} x1="0" x2="1" y1="0" y2="0">
                    <stop offset="50%" stopColor={lane === 0 ? 'var(--voice-a)' : 'var(--voice-b)'} />
                    <stop offset="50%" stopColor="var(--field)" />
                  </linearGradient>
                ))}
              </defs>

              {/* who is speaking */}
              {[sideA, sideB].map((p, i) =>
                p ? (
                  <g key={`sp${i}`}>
                    {model.speaking
                      .filter((u) => u.key === p.key)
                      .map((u, j) => (
                        <rect key={j} x={xs(u.startMs)} y={SPEAK + i * 7} width={Math.max(1, xs(u.endMs) - xs(u.startMs))} height={5} fill={VOICE_VAR[p.voice]} opacity={future(u.startMs) ? 0 : 0.75} />
                      ))}
                  </g>
                ) : null,
              )}
              <text x={ML - 10} y={SPEAK + 9} fontSize={10.5} textAnchor="end" fill="var(--ink-3)">
                speaking
              </text>

              {/* time axis */}
              <line x1={ML} x2={ML + plotW} y1={AXIS} y2={AXIS} stroke="var(--border-2)" />
              {ticks.map((v) => (
                <g key={v}>
                  <line x1={xs(v)} x2={xs(v)} y1={AXIS} y2={AXIS + 5} stroke="var(--ink-3)" />
                  <text x={xs(v)} y={AXIS + 18} fontSize={11} textAnchor="middle" fill="var(--ink-3)" fontFamily="var(--font-mono)">
                    {clock(v)}
                  </text>
                </g>
              ))}

              {/* the gap over time */}
              <text x={0} y={GAP_TOP + 14} fontSize={12} fill="var(--ink-2)">
                Open disagreements
              </text>
              <text x={0} y={GAP_TOP + 32} fontSize={12} fill="var(--convergence)">
                Shared
              </text>
              <line x1={ML} x2={ML + plotW} y1={GAP_TOP + GAP_H} y2={GAP_TOP + GAP_H} stroke="var(--border)" />
              <text x={ML - 10} y={GAP_TOP + 12} fontSize={10.5} textAnchor="end" fill="var(--ink-3)" fontFamily="var(--font-mono)">
                {maxCount}
              </text>
              <path d={stepPath('disputes')} fill="none" stroke="var(--ink-2)" strokeWidth={1.75} />
              <path d={stepPath('shared')} fill="none" stroke="var(--convergence)" strokeWidth={1.75} />
              <rect x={px} y={GAP_TOP - 4} width={Math.max(0, ML + plotW - px)} height={GAP_H + 8} fill="var(--field)" opacity={0.7} />

              {/* playhead */}
              <line x1={px} x2={px} y1={10} y2={GAP_TOP + GAP_H} stroke="var(--ink)" strokeWidth={1} />
              <circle cx={px} cy={10} r={4.5} fill="var(--ink)" />
            </svg>

            {hover ? <HoverCard s={live} meta={meta} pid={hover.pid} x={hover.x} y={hover.y} width={width} /> : null}

            {!hasContent ? (
              <p className="pointer-events-none absolute left-[168px] top-[150px] text-ink-3">
                {model.speaking.length ? 'Transcript arriving. No stances mapped yet.' : 'Waiting for the first utterance.'}
              </p>
            ) : null}
          </div>

          <p className="mt-4 text-[13px] text-ink-2 tabular">
            At {clock(tNow)}: <span className="text-ink">{counts.disputes}</span> open {counts.disputes === 1 ? 'disagreement' : 'disagreements'} (one side accepts what the other rejects),{' '}
            <span className="text-convergence">{counts.shared}</span> shared {counts.shared === 1 ? 'proposition' : 'propositions'} (both accept, at least leaning).
          </p>

          <Legend />
        </section>

        <EvidencePane selected={selected} onClose={() => setSelected(null)}>
          {selected && !selected.startsWith('hg:') ? (
            <PropositionInspector
              s={atT}
              meta={meta}
              pid={selected}
              tNow={tNow}
              crux={(() => {
                const c = currentCard(atT, 'crux');
                if (!c || c.body.propositionId !== selected) return null;
                return { body: c.body, tMs: model.cards.find((m) => m.id === c.insight.id)?.tMs ?? tNow };
              })()}
              query={(sel) => `?t=${Math.round(tNow / 1000)}&sel=${encodeURIComponent(sel)}`}
              from="arc"
              onSelect={setSelected}
              onSeek={(ms) => {
                ph.pause();
                setT(ms);
              }}
              onClose={() => setSelected(null)}
            />
          ) : (
            <MomentPanel
              s={atT}
              meta={meta}
              tMs={tNow}
              onSeek={(ms) => {
                ph.pause();
                setT(ms);
              }}
            />
          )}
        </EvidencePane>
      </div>

      <TimeDock rounds={model.rounds} bands={model.bands} ended={meta.ended} />
    </main>
  );
}

/** Split a display name into at most two short lines for the lane label column. */
function nameLines(name: string): string[] {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.join(' ').length <= 11 || words.length === 1) return [truncate(name, 12)];
  const last = words.pop()!;
  return [truncate(words.join(' '), 12), truncate(last, 12)];
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, Math.max(1, n - 1)).trimEnd()}…`;
}

function HoverCard({ s, meta, pid, x, y, width }: { s: SessionState; meta: SessionMeta; pid: string; x: number; y: number; width: number }) {
  const p = s.propositions.get(pid)?.value;
  if (!p) return null;
  const left = Math.min(Math.max(8, x - 160), width - 330);
  const above = y > 220;
  return (
    <div
      className="pointer-events-none absolute z-10 w-[320px] border border-border bg-surface px-3 py-2 text-sm"
      style={{ left, top: above ? y - 12 : y + 14, transform: above ? 'translateY(-100%)' : undefined }}
    >
      <p className="text-[14px] font-medium leading-snug text-ink">{p.canonical}</p>
      <p className="mt-1 text-xs text-ink-3">
        {p.type} · {STRATUM_LABEL[p.stratum]}
      </p>
      <p className="mt-1 text-xs text-ink-2">
        {[...s.stances.values()]
          .filter((t) => t.value.propositionId === pid && t.state !== 'rejected' && t.state !== 'merged')
          .map((t) => `${personOf(meta, t.value.participantKey).displayName} ${ATTITUDE_LABEL[t.value.attitude]}`)
          .join('; ')}
      </p>
    </div>
  );
}

function Legend() {
  const item = 'inline-flex items-center gap-2';
  return (
    <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-4 text-xs text-ink-2">
      <span className={item}>
        <svg width="14" height="14" aria-hidden><circle cx="7" cy="7" r="5" fill="var(--ink-2)" /></svg>accepts
      </span>
      <span className={item}>
        <svg width="14" height="14" aria-hidden><circle cx="7" cy="7" r="5" fill="var(--field)" stroke="var(--ink-2)" strokeWidth="1.5" /></svg>rejects
      </span>
      <span className={item}>
        <svg width="14" height="14" aria-hidden><circle cx="7" cy="7" r="5" fill="var(--ink-2)" stroke="var(--ink-2)" strokeWidth="1.5" strokeDasharray="2 1.5" /></svg>
        via a concession or rhetorical question
      </span>
      <span className={item}>size: strength of the stance</span>
      <span className={item}>distance from centre: stratum, praxis nearest</span>
      <span className={item}>
        <svg width="26" height="14" aria-hidden>
          <path d="M1,2 Q13,2 13,7" fill="none" stroke="var(--voice-a)" strokeWidth="2" />
          <path d="M25,12 Q13,12 13,7" fill="none" stroke="var(--voice-b)" strokeWidth="2" />
        </svg>
        disagreement (faded once resolved)
      </span>
      <span className={item}>
        <svg width="22" height="14" aria-hidden><path d="M1,12 C11,2 11,2 21,12" fill="none" stroke="var(--ink-3)" /></svg>rebuttal across sides
      </span>
      <span className={item}>
        <svg width="14" height="14" aria-hidden><rect x="3" y="3" width="8" height="8" transform="rotate(45 7 7)" fill="var(--convergence)" /></svg>shared
      </span>
      <span className={item}>
        <svg width="16" height="16" aria-hidden><circle cx="8" cy="8" r="6" fill="none" stroke="var(--convergence)" strokeWidth="2" /><circle cx="8" cy="8" r="2" fill="var(--convergence)" /></svg>higher-ground card
      </span>
      <span className={item}>
        <svg width="16" height="16" aria-hidden><rect x="4" y="4" width="8" height="8" transform="rotate(45 8 8)" fill="none" stroke="var(--ink)" strokeWidth="1.5" /></svg>crux card
      </span>
    </div>
  );
}

function MomentPanel({ s, meta, tMs, onSeek }: { s: SessionState; meta: SessionMeta; tMs: number; onSeek: (ms: number) => void }) {
  const lines = s.utteranceOrder.slice(-7).map((id) => s.utterances.get(id)!);
  return (
    <div>
      <p className="label-caps text-ink-3">At {clock(tMs)}</p>
      <p className="mt-1 text-[15px] text-ink">{s.round ? s.round.name : 'No round marked'}</p>
      <p className="mt-3 text-[14px] text-ink-3">Select a mark to inspect its sources.</p>
      <div className="mt-6 space-y-5">
        <PanelBlock title="The crux then">
          <CruxBody s={s} meta={meta} size="compact" />
        </PanelBlock>
        <PanelBlock title="Higher ground">
          <HigherGroundBody s={s} meta={meta} size="compact" />
        </PanelBlock>
        <PanelBlock title="Already shared">
          <SharedBody s={s} meta={meta} size="compact" />
        </PanelBlock>
        <PanelBlock title="Try asking">
          <PromptBody s={s} meta={meta} size="compact" />
        </PanelBlock>
      </div>
      <h3 className="label-caps mt-8 border-t border-border pt-4 text-ink-3">Transcript</h3>
      <ol className="mt-2 space-y-3">
        {lines.length === 0 ? <li className="text-sm text-ink-3">Nothing said yet at this point.</li> : null}
        {lines.map((u, i) => (
          <li key={u.id} className={`grid grid-cols-[3px_1fr] gap-3 text-[14px] leading-snug ${i === lines.length - 1 ? 'text-ink' : 'text-ink-2'}`}>
            <span aria-hidden className="rounded" style={{ background: voiceColor(meta, u.participantKey) }} />
            <span>
              <button type="button" onClick={() => onSeek(u.startMs)} className="mr-2 font-mono text-xs text-ink-3 hover:text-ink">
                {clock(u.startMs)}
              </button>
              <span className="text-xs font-medium" style={{ color: voiceColor(meta, u.participantKey) }}>
                {personOf(meta, u.participantKey).displayName}
              </span>
              <span className="mt-0.5 block">{u.text.length > 360 ? `${u.text.slice(0, 360)}…` : u.text}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function PanelBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-4">
      <h3 className="label-caps mb-2 text-ink-3">{title}</h3>
      {children}
    </section>
  );
}
