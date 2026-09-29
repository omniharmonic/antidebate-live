'use client';

/**
 * Evidence inspector (DIRECTION §6 "Selection and evidence"): canonical text,
 * type and stratum, each debater's stance at the playhead, review status, the
 * exact source words with speaker and media time, and relations. Shared by the
 * Spatial, Timeline and Positions lenses so a selection reads the same everywhere.
 */
import Link from 'next/link';
import type { SessionState, Tracked } from '@adl/core';
import type { CruxCard, HigherGroundCard, Proposition, Stance } from '@adl/ontology';
import { ATTITUDE_LABEL, CONSTRUCTION_LABEL, SETTLING_LABEL, clock, isLive, personOf, voiceColor, type SessionMeta } from '@/lib/derive';
import { STRATUM_LABEL } from '@/lib/spatial-model';
import type { SurfaceId } from '@/components/SessionBar';

const REL_LABEL: Record<string, [string, string]> = {
  supports: ['supports', 'supported by'],
  rebuts: ['rebuts', 'rebutted by'],
  undercuts: ['undercuts', 'undercut by'],
  undermines: ['undermines', 'undermined by'],
  qualifies: ['qualifies', 'qualified by'],
  concedes: ['concedes', 'conceded by'],
  agrees: ['agrees with', 'agreed with by'],
  equivalent: ['equivalent to', 'equivalent to'],
  presupposes: ['presupposes', 'presupposed by'],
  defines: ['defines', 'defined by'],
  exemplifies: ['exemplifies', 'exemplified by'],
  answers: ['answers', 'answered by'],
  evades: ['evades', 'evaded by'],
};

const SPEECH_ACT_LABEL: Record<string, string> = {
  concede: 'concession',
  rhetorical_question: 'rhetorical question',
  commit_conditional: 'conditional commitment',
  steelman_report: 'steelman report',
  attribute: 'attribution',
  nonliteral: 'non-literal',
  retract: 'retraction',
};

export function statusLabel(t: Tracked<unknown>): string {
  switch (t.state) {
    case 'approved':
      return 'Approved';
    case 'released':
      return 'Released to audience';
    case 'proposed':
      return 'Proposed, not yet reviewed';
    case 'rejected':
      return 'Rejected';
    case 'merged':
      return 'Merged';
    case 'retracted':
      return 'Retracted';
  }
}

export function StanceGlyph({ attitude, color, size = 12 }: { attitude: Stance['attitude']; color: string; size?: number }) {
  const r = size / 2 - 1.5;
  const c = size / 2;
  if (attitude === 'rejects') return <svg width={size} height={size} aria-hidden className="shrink-0"><circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={1.5} /></svg>;
  if (attitude === 'suspends')
    return (
      <svg width={size} height={size} aria-hidden className="shrink-0">
        <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={1.5} />
        <path d={`M${c},${c - r} A${r},${r} 0 0 0 ${c},${c + r} Z`} fill={color} />
      </svg>
    );
  return <svg width={size} height={size} aria-hidden className="shrink-0"><circle cx={c} cy={c} r={r} fill={color} stroke={color} strokeWidth={1.5} /></svg>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-4">
      <h3 className="label-caps mb-3 text-ink-3">{title}</h3>
      {children}
    </section>
  );
}

export function PropositionInspector({
  s,
  meta,
  pid,
  alias,
  tNow,
  crux,
  query,
  from,
  onSelect,
  onSeek,
  onClose,
}: {
  s: SessionState;
  meta: SessionMeta;
  pid: string;
  alias?: string;
  tNow: number;
  /** The crux card current at the playhead, when it is about this proposition. */
  crux?: { body: CruxCard; tMs: number } | null;
  query: (sel: string) => string;
  from: SurfaceId;
  onSelect: (pid: string) => void;
  onSeek: (ms: number) => void;
  onClose: () => void;
}) {
  const tracked = s.propositions.get(pid) as Tracked<Proposition> | undefined;
  if (!tracked) {
    return (
      <div>
        <CloseRow onClose={onClose} />
        <p className="text-[15px] text-ink-3">This proposition is not in the map.</p>
      </div>
    );
  }
  const p = tracked.value;
  const all = [...s.stances.values()].filter((t) => isLive(t) && t.value.propositionId === pid).map((t) => t.value).sort((a, b) => a.atMs - b.atMs);
  const first = all[0]?.atMs ?? null;
  const now = all.filter((st) => st.atMs <= tNow);
  const later = all.length - now.length;
  const base = `/s/${encodeURIComponent(meta.sessionId)}`;

  if (first !== null && first > tNow) {
    return (
      <div className="arrive">
        <CloseRow onClose={onClose} alias={alias} />
        <p className="text-[17px] leading-snug text-ink-2">This proposition is not present at this moment.</p>
        <p className="mt-2 text-[14px] text-ink-3">It is first asserted at {clock(first)}.</p>
        <button type="button" onClick={() => onSeek(first)} className="mt-4 h-9 rounded-[3px] border border-border-2 px-3 text-[13px] text-ink hover:bg-field-deep">
          Go to {clock(first)}
        </button>
      </div>
    );
  }

  // latest stance per participant at the playhead
  const latest = new Map<string, Stance>();
  for (const st of now) if (st.source !== 'inferred') latest.set(st.participantKey, st);
  const debaters = meta.sides.filter((x): x is NonNullable<typeof x> => Boolean(x));
  const rels = [...s.relations.values()].filter((t) => isLive(t) && (t.value.fromId === pid || t.value.toId === pid)).map((t) => t.value);

  return (
    <div className="arrive space-y-5">
      <div>
        <CloseRow onClose={onClose} alias={alias} kind={p.type === p.stratum ? STRATUM_LABEL[p.stratum] : `${p.type} · ${STRATUM_LABEL[p.stratum]}`} />
        <p className="text-[24px] font-medium leading-[1.25] tracking-[-0.01em] text-ink">{p.canonical}</p>
        {p.conditions.length ? <p className="mt-2 text-[14px] text-ink-2">Conditions: {p.conditions.join('; ')}</p> : null}
        {p.scope?.timeHorizon ? <p className="mt-1 text-[13px] text-ink-3">Time horizon: {p.scope.timeHorizon}</p> : null}
      </div>

      <ul className="space-y-2.5">
        {debaters.map((d) => {
          const st = latest.get(d.key);
          const color = voiceColor(meta, d.key);
          return (
            <li key={d.key} className="flex items-center gap-3 text-[15px]">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[3px] font-mono text-[12px] font-medium text-field" style={{ background: color }} aria-hidden>
                {d.voice.toUpperCase()}
              </span>
              <span className="min-w-0">
                <span className="text-ink">{d.displayName}</span>{' '}
                {st ? (
                  <span className="text-ink-2">
                    {ATTITUDE_LABEL[st.attitude]} · {st.strength}
                    {st.credence !== undefined ? ` · credence ${st.credence}` : ''}
                    {st.source === 'implied_by_act' ? ' · implied by an act' : ''}
                  </span>
                ) : (
                  <span className="text-ink-3">no stance</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {later > 0 ? <p className="text-[13px] text-ink-3">{later === 1 ? 'One later stance is' : `${later} later stances are`} hidden at this moment.</p> : null}

      <p className="text-[13px] text-ink-2">
        <span className="text-ink-3">Status </span>
        {statusLabel(tracked)}
        {tracked.issues.length ? <span className="text-insight"> · {tracked.issues.length} validator {tracked.issues.length === 1 ? 'flag' : 'flags'}</span> : null}
        {tracked.critic && tracked.critic.verdict !== 'pass' ? <span className="text-insight"> · critic: {tracked.critic.verdict}</span> : null}
      </p>

      {crux ? (
        <Section title="Crux candidate">
          <p className="text-[14px] leading-snug text-ink-2">
            The crux card current at {clock(tNow)}, since {clock(crux.tMs)}. Settles by {SETTLING_LABEL[crux.body.settlingEvidence]}.
            {crux.body.basis === 'clash' ? ' Inferred from opposing claims.' : ''}
          </p>
          {Object.entries(crux.body.updateConditions)
            .filter(([, v]) => v && v !== 'not stated')
            .map(([k, v]) => (
              <p key={k} className="mt-2 border-l-2 pl-3 text-[14px] leading-snug text-ink" style={{ borderColor: voiceColor(meta, k) }}>
                <span className="text-ink-3">{personOf(meta, k).displayName} would update if: </span>
                {v}
              </p>
            ))}
        </Section>
      ) : null}

      <Section title="Source words">
        {now.length === 0 ? <p className="text-[14px] text-ink-3">Source span unavailable.</p> : null}
        <ul className="space-y-4">
          {now.map((st) => {
            const adu = st.viaAduId ? s.adus.get(st.viaAduId)?.value : undefined;
            const u = adu ? s.utterances.get(adu.spans[0]?.utteranceId ?? '') : undefined;
            const speaker = adu?.speakerKey ?? st.participantKey;
            const at = u?.startMs ?? st.atMs;
            const act = adu && adu.speechAct !== 'assert' ? SPEECH_ACT_LABEL[adu.speechAct] ?? adu.speechAct.replaceAll('_', ' ') : null;
            return (
              <li key={st.id}>
                <p className="flex flex-wrap items-baseline gap-x-3 text-[13px]">
                  <span className="font-medium" style={{ color: voiceColor(meta, speaker) }}>
                    {personOf(meta, speaker).displayName}
                  </span>
                  <button type="button" onClick={() => onSeek(at)} className="font-mono text-[12px] text-ink-3 underline decoration-border underline-offset-2 hover:text-ink" aria-label={`Go to ${clock(at)}`}>
                    {clock(at)}
                  </button>
                  {act ? <span className="text-ink-3">{act}</span> : null}
                  {speaker !== st.participantKey ? <span className="text-ink-3">stance of {personOf(meta, st.participantKey).displayName}</span> : null}
                </p>
                {adu ? (
                  <blockquote className="mt-1.5 text-[15px] leading-[1.5] text-ink">&ldquo;{adu.spans.map((x) => x.quote).join(' … ')}&rdquo;</blockquote>
                ) : (
                  <p className="mt-1 text-[14px] text-ink-3">Source span unavailable.</p>
                )}
              </li>
            );
          })}
        </ul>
      </Section>

      {rels.length ? (
        <Section title={`Relations (${rels.length})`}>
          <ul className="space-y-2.5">
            {rels.map((r) => {
              const out = r.fromId === pid;
              const other = out ? r.toId : r.fromId;
              const text = s.propositions.get(other)?.value.canonical ?? other;
              const [fwd, back] = REL_LABEL[r.type] ?? [r.type, `${r.type} by`];
              return (
                <li key={r.id} className="text-[14px] leading-snug">
                  <span className="text-ink-3">
                    {out ? fwd : back}
                    {r.inferred ? ' · inferred' : ''}
                  </span>{' '}
                  <button type="button" onClick={() => onSelect(other)} className="text-left text-ink-2 hover:text-ink hover:underline hover:decoration-border-2 hover:underline-offset-4">
                    {text}
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}

      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        {from !== 'arc' ? (
          <Link href={`${base}/arc${query(pid)}`} className="inline-flex h-9 items-center gap-2 rounded-[3px] border border-border-2 px-3 text-[13px] text-ink hover:bg-field-deep">
            View in timeline <span aria-hidden>→</span>
          </Link>
        ) : null}
        {from !== 'spatial' ? (
          <Link href={`${base}/spatial${query(pid)}`} className="inline-flex h-9 items-center gap-2 rounded-[3px] border border-border px-3 text-[13px] text-ink-2 hover:text-ink">
            View in spatial
          </Link>
        ) : null}
        {from !== 'positions' ? (
          <Link href={`${base}/positions${query(pid)}`} className="inline-flex h-9 items-center gap-2 rounded-[3px] border border-border px-3 text-[13px] text-ink-2 hover:text-ink">
            View in positions
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function CloseRow({ onClose, alias, kind }: { onClose: () => void; alias?: string; kind?: string }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-4">
      <p className="label-caps text-ink-3">
        {alias ? <span className="font-mono normal-case tracking-normal text-ink-2">{alias}</span> : null}
        {alias && kind ? <span className="mx-2 text-ink-ghost">/</span> : null}
        {kind}
      </p>
      <button type="button" onClick={onClose} className="h-8 rounded-[3px] px-2 text-[13px] text-ink-3 hover:bg-field-deep hover:text-ink" aria-label="Close inspector (Escape)">
        Close
      </button>
    </div>
  );
}

export function HigherGroundInspector({ s, meta, body, tMs, onSelect, onClose }: { s: SessionState; meta: SessionMeta; body: HigherGroundCard; tMs: number; onSelect: (pid: string) => void; onClose: () => void }) {
  return (
    <div className="arrive space-y-5">
      <div>
        <div className="mb-3 flex items-center justify-between gap-4">
          <p className="label-caps text-convergence">Higher ground · Candidate</p>
          <button type="button" onClick={onClose} className="h-8 rounded-[3px] px-2 text-[13px] text-ink-3 hover:bg-field-deep hover:text-ink">
            Close
          </button>
        </div>
        <p className="text-[24px] font-medium leading-[1.25] text-ink">{body.text}</p>
        <p className="mt-2 text-[13px] text-ink-2">
          {CONSTRUCTION_LABEL[body.construction]} · proposed at <span className="font-mono">{clock(tMs)}</span>
          {body.reliesOnInferred ? ' · relies on an inferred link' : ''}
        </p>
        <p className="mt-2 text-[13px] text-ink-3">Not confirmed by participants.</p>
      </div>
      {Object.keys(body.costs).length ? (
        <Section title="What each would give up">
          <ul className="space-y-2">
            {Object.entries(body.costs).map(([k, cost]) => (
              <li key={k} className="border-l-2 pl-3 text-[14px] leading-snug text-ink" style={{ borderColor: voiceColor(meta, k) }}>
                <span className="text-ink-3">{personOf(meta, k).displayName}: </span>
                {cost}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      <Section title="Built from">
        <div className="space-y-4">
          {Object.entries(body.derivation).map(([k, ids]) => (
            <div key={k}>
              <p className="text-[13px] text-ink-3">What {personOf(meta, k).displayName} accepts</p>
              <ul className="mt-1.5 space-y-1.5">
                {ids.map((id) => (
                  <li key={id} className="border-l-2 pl-3" style={{ borderColor: voiceColor(meta, k) }}>
                    <button type="button" onClick={() => onSelect(id)} className="text-left text-[14px] leading-snug text-ink-2 hover:text-ink">
                      {s.propositions.get(id)?.value.canonical ?? <span className="font-mono text-ink-3">{id}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
