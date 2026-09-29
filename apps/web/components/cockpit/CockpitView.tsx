'use client';

/**
 * Facilitator cockpit (UX §3, Glance mode). Dark, tablet landscape, four fixed
 * quadrants. Shows the newest approved-or-sent card of each kind; nothing else.
 * Also used by the arc view's side panel (compact) for the state at the playhead.
 */
import { useEffect, useState } from 'react';
import type { SessionState } from '@adl/core';
import { StatusDot } from '@/components/SessionBar';
import {
  ATTITUDE_LABEL,
  CONSTRUCTION_LABEL,
  SETTLING_LABEL,
  canonical,
  clock,
  currentCard,
  graphOf,
  personOf,
  visiblePrompts,
  voiceColor,
  type SessionMeta,
} from '@/lib/derive';
import { useSession } from '@/lib/use-session';

export function Cockpit({ sessionId }: { sessionId: string }) {
  const data = useSession(sessionId);
  const { live: s, meta } = data;
  const round = s.round;
  const roundPhase = round ? meta.format.phases.find((p) => p.id === meta.format.rounds.find((r) => r.id === round.roundId)?.phase)?.name : null;

  return (
    <main data-surface="stage" className="flex min-h-dvh flex-col bg-field text-ink" style={{ fontSize: 22 }}>
      <header className="flex items-baseline gap-6 border-b border-border px-8 py-4 text-[18px]">
        <p className="min-w-0 flex-1 truncate">
          {round ? (
            <>
              <span className="text-ink">{round.name}</span>
              {roundPhase ? <span className="text-ink-3"> in {roundPhase}</span> : null}
            </>
          ) : (
            <span className="text-ink-3">{meta.title}</span>
          )}
        </p>
        {round ? (
          <p className="font-mono text-[18px] text-ink-2 tabular" title="Time in this round (recording time)">
            {clock(s.lastMediaMs - round.startedMediaMs)} in round
          </p>
        ) : null}
        <p className="font-mono text-[18px] text-ink-3 tabular" title="Time since the session started (recording time)">
          {clock(s.lastMediaMs)}
        </p>
        <span className="text-[15px]">
          <StatusDot status={data.status} />
        </span>
      </header>

      <div className="grid flex-1 grid-cols-1 md:grid-cols-2 md:grid-rows-2">
        <Quadrant title="The crux now" className="md:border-r">
          <CruxBody s={s} meta={meta} size="full" />
        </Quadrant>
        <Quadrant title="Higher ground">
          <HigherGroundBody s={s} meta={meta} size="full" />
        </Quadrant>
        <Quadrant title="Already shared" className="md:border-r">
          <SharedBody s={s} meta={meta} size="full" />
        </Quadrant>
        <Quadrant title="Try asking">
          <PromptBody s={s} meta={meta} size="full" />
        </Quadrant>
      </div>

      <LedgerStrip s={s} meta={meta} />
    </main>
  );
}

function Quadrant({ title, className = '', children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className={`flex min-h-0 flex-col border-b border-border px-8 pb-8 pt-6 ${className}`}>
      <h2 className="mb-5 font-sans text-[17px] font-medium tracking-wide text-ink-3">{title}</h2>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

type Size = 'full' | 'compact';

function Quiet({ children, size }: { children: React.ReactNode; size: Size }) {
  return <p className={`text-ink-3 ${size === 'full' ? 'text-[22px]' : 'text-sm'}`}>{children}</p>;
}

/** Expand on tap, auto-collapse after 20 s (UX §3). */
function useExpand(resetKey: string | undefined) {
  const [open, setOpen] = useState<string | null>(null);
  const isOpen = open !== null && open === resetKey;
  useEffect(() => {
    if (!isOpen) return;
    const t = setTimeout(() => setOpen(null), 20_000);
    return () => clearTimeout(t);
  }, [isOpen]);
  return { isOpen, toggle: () => setOpen(isOpen ? null : (resetKey ?? null)) };
}

function ExpandButton({ open, onClick, size }: { open: boolean; onClick: () => void; size: Size }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className={`mt-5 rounded border border-border-2 px-3 py-1 text-ink-2 hover:text-ink ${size === 'full' ? 'text-[17px]' : 'text-xs'}`}
    >
      {open ? 'Hide the words' : 'Show the words'}
    </button>
  );
}

export function CruxBody({ s, meta, size }: { s: SessionState; meta: SessionMeta; size: Size }) {
  const card = currentCard(s, 'crux');
  const { isOpen, toggle } = useExpand(card?.insight.id);
  if (!card) return <Quiet size={size}>Listening. No crux yet.</Quiet>;
  const b = card.body;
  const statement = canonical(s, b.propositionId) ?? b.statement;
  const quoteFor = (stanceId: string, fallback: string) => {
    if (fallback) return fallback;
    const st = s.stances.get(stanceId)?.value;
    const adu = st?.viaAduId ? s.adus.get(st.viaAduId) : undefined;
    return adu ? adu.value.spans.map((x) => x.quote).join(' … ') : '';
  };
  return (
    <div key={card.insight.id} className="arrive">
      <p className={`font-display leading-[1.15] ${size === 'full' ? 'text-[38px]' : 'text-[22px]'}`}>{statement}</p>
      <ul className={`mt-5 space-y-2 ${size === 'full' ? 'text-[22px]' : 'text-sm'}`}>
        {b.sides.map((side) => (
          <li key={side.participantKey + side.stanceId} className="flex items-baseline gap-3">
            <span aria-hidden className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ background: voiceColor(meta, side.participantKey) }} />
            <span className="text-ink">{personOf(meta, side.participantKey).displayName}</span>
            <span className="text-ink-2">
              {side.via ? (
                <>
                  {side.via.relation === 'undercuts' ? 'undercuts it' : 'rejects it'}, via: <span className="text-ink">&lsquo;{canonical(s, side.via.propositionId) ?? side.via.statement}&rsquo;</span>
                </>
              ) : (
                <>
                  {ATTITUDE_LABEL[side.attitude]}, {side.strength}
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className={`mt-4 text-ink-2 ${size === 'full' ? 'text-[20px]' : 'text-sm'}`}>
        Settles by {SETTLING_LABEL[b.settlingEvidence]}
        {b.basis === 'clash' ? <span className="text-ink-3"> · inferred from opposing claims</span> : null}
      </p>
      {size === 'full' ? (
        <>
          <ExpandButton open={isOpen} onClick={toggle} size={size} />
          {isOpen ? (
            <div className="arrive mt-5 space-y-4 text-[19px] leading-snug">
              {b.sides.map((side) => {
                const q = quoteFor(side.stanceId, side.quote);
                const cond = b.updateConditions[side.participantKey];
                return (
                  <div key={'q' + side.participantKey} className="border-l-2 pl-4" style={{ borderColor: voiceColor(meta, side.participantKey) }}>
                    {q ? <p className="text-ink">&ldquo;{q}&rdquo;</p> : <p className="text-ink-3">No quote attached.</p>}
                    {cond && cond !== 'not stated' ? <p className="mt-1 text-ink-2">Would update if: {cond}</p> : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function HigherGroundBody({ s, meta, size }: { s: SessionState; meta: SessionMeta; size: Size }) {
  const card = currentCard(s, 'higher_ground');
  const { isOpen, toggle } = useExpand(card?.insight.id);
  if (!card) return <Quiet size={size}>No candidate yet.</Quiet>;
  const b = card.body;
  return (
    <div key={card.insight.id} className="arrive">
      <p className={`font-display leading-[1.2] ${size === 'full' ? 'text-[32px]' : 'text-[20px]'}`} style={{ color: 'var(--convergence)' }}>
        {b.text}
      </p>
      <p className={`mt-3 text-ink-3 ${size === 'full' ? 'text-[18px]' : 'text-xs'}`}>
        {CONSTRUCTION_LABEL[b.construction]}
        {b.reliesOnInferred ? ' · relies on an inferred link' : ''}
      </p>
      <ul className={`mt-4 space-y-1.5 ${size === 'full' ? 'text-[20px]' : 'text-sm'}`}>
        {Object.entries(b.costs).map(([k, cost]) => (
          <li key={k} className="flex items-baseline gap-3">
            <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: voiceColor(meta, k) }} />
            <span>
              <span className="text-ink-2">{personOf(meta, k).displayName} gives up:</span> {cost}
            </span>
          </li>
        ))}
      </ul>
      {size === 'full' ? (
        <>
          <ExpandButton open={isOpen} onClick={toggle} size={size} />
          {isOpen ? (
            <div className="arrive mt-5 space-y-3 text-[18px] leading-snug">
              {Object.entries(b.derivation).map(([k, ids]) => (
                <div key={'d' + k} className="border-l-2 pl-4" style={{ borderColor: voiceColor(meta, k) }}>
                  <p className="text-ink-3">Built from what {personOf(meta, k).displayName} accepts:</p>
                  {ids.map((id) => (
                    <p key={id} className="text-ink">
                      {canonical(s, id) ?? <span className="font-mono text-ink-3">{id}</span>}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function SharedBody({ s, meta, size }: { s: SessionState; meta: SessionMeta; size: Size }) {
  const card = currentCard(s, 'shared');
  let groups: { label: string; ids: string[] }[];
  let computed = false;
  if (card) {
    groups = [
      { label: 'Ends', ids: card.body.ends },
      { label: 'Facts', ids: card.body.facts },
      { label: 'Framings', ids: card.body.framings },
    ].filter((g) => g.ids.length > 0);
  } else {
    // no shared card yet: the same computation, from approved-or-proposed live stances
    const ids = graphOf(s, meta).shared;
    groups = ids.length ? [{ label: '', ids }] : [];
    computed = ids.length > 0;
  }
  if (groups.length === 0) return <Quiet size={size}>Nothing both have accepted yet.</Quiet>;
  const max = size === 'full' ? 5 : 3;
  let shown = 0;
  return (
    <div key={card?.insight.id ?? 'computed'} className="arrive">
      {groups.map((g) => (
        <div key={g.label} className="mb-3">
          {g.label && groups.length > 1 ? <p className={`text-ink-3 ${size === 'full' ? 'text-[17px]' : 'text-xs'}`}>{g.label}</p> : null}
          <ul className={`space-y-2 ${size === 'full' ? 'text-[22px] leading-snug' : 'text-sm'}`}>
            {g.ids.map((id) => {
              if (shown >= max) return null;
              shown++;
              return (
                <li key={id} className="flex gap-3">
                  <span aria-hidden className="mt-[0.55em] inline-block h-1.5 w-1.5 shrink-0 rotate-45" style={{ background: 'var(--convergence)' }} />
                  <span>{canonical(s, id) ?? id}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {groups.reduce((n, g) => n + g.ids.length, 0) > max ? (
        <p className={`text-ink-3 ${size === 'full' ? 'text-[17px]' : 'text-xs'}`}>and {groups.reduce((n, g) => n + g.ids.length, 0) - max} more</p>
      ) : null}
      {computed ? <p className={`mt-2 text-ink-3 ${size === 'full' ? 'text-[15px]' : 'text-xs'}`}>Both accept these, from their stated stances.</p> : null}
    </div>
  );
}

export function PromptBody({ s, meta, size }: { s: SessionState; meta: SessionMeta; size: Size }) {
  const prompts = visiblePrompts(s);
  const [idx, setIdx] = useState(0);
  const newest = prompts[0]?.insight.id;
  const [seenNewest, setSeenNewest] = useState(newest);
  if (newest !== seenNewest) {
    setSeenNewest(newest);
    setIdx(0);
  }
  if (prompts.length === 0) return <Quiet size={size}>No question queued.</Quiet>;
  const i = Math.min(idx, prompts.length - 1);
  const p = prompts[i]!;
  const who = p.body.addresseeKey === 'both' ? 'Both' : personOf(meta, p.body.addresseeKey).displayName;
  return (
    <div>
      <div key={p.insight.id} className="arrive">
        <p className={`text-ink-3 ${size === 'full' ? 'text-[18px]' : 'text-xs'}`}>
          {p.body.addresseeKey !== 'both' ? (
            <span aria-hidden className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: voiceColor(meta, p.body.addresseeKey) }} />
          ) : null}
          To {who}
        </p>
        <p className={`mt-2 font-display leading-[1.2] ${size === 'full' ? 'text-[32px]' : 'text-[19px]'}`}>&ldquo;{p.body.text}&rdquo;</p>
        {p.body.targets.length > 0 && size === 'full' ? (
          <p className="mt-3 text-[18px] text-ink-3">About: {p.body.targets.map((id) => canonical(s, id)).filter(Boolean).slice(0, 1).join('')}</p>
        ) : null}
      </div>
      {prompts.length > 1 && size === 'full' ? (
        <div className="mt-6 flex items-center gap-3 text-[17px] text-ink-3">
          <button type="button" className="rounded border border-border-2 px-3 py-1 hover:text-ink disabled:opacity-40" disabled={i === 0} onClick={() => setIdx(i - 1)}>
            Newer
          </button>
          <span className="tabular">
            {i + 1} of {prompts.length}
          </span>
          <button type="button" className="rounded border border-border-2 px-3 py-1 hover:text-ink disabled:opacity-40" disabled={i >= prompts.length - 1} onClick={() => setIdx(i + 1)}>
            Older
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Ledgers: counts with their definitions, and the newest steelman. */
function LedgerStrip({ s, meta }: { s: SessionState; meta: SessionMeta }) {
  let questions = 0;
  let concessions = 0;
  let steelman: { by: string; of: string; atMs: number } | null = null;
  for (const t of s.adus.values()) {
    if (t.state === 'rejected') continue;
    const a = t.value;
    if (a.speechAct === 'question') questions++;
    if (a.speechAct === 'concede') concessions++;
    if (a.speechAct === 'steelman_report') {
      const u = s.utterances.get(a.spans[0]?.utteranceId ?? '');
      const of = a.addressedTo !== 'none' && a.addressedTo !== 'audience' ? a.addressedTo : '';
      steelman = { by: a.speakerKey, of, atMs: u?.startMs ?? 0 };
    }
  }
  return (
    <footer className="flex flex-wrap items-center gap-x-10 gap-y-2 px-8 py-4 text-[18px] text-ink-2">
      <span title="Question speech acts in the map">
        Questions asked <span className="font-mono text-ink tabular">{questions}</span>
      </span>
      <span title="Concession speech acts in the map">
        Concessions <span className="font-mono text-ink tabular">{concessions}</span>
      </span>
      <span className="min-w-0 flex-1 truncate text-right">
        {steelman ? (
          <>
            Steelman: {personOf(meta, steelman.by).displayName}
            {steelman.of ? ` of ${personOf(meta, steelman.of).displayName}` : ''} <span className="font-mono text-ink-3">{clock(steelman.atMs)}</span>
          </>
        ) : (
          <span className="text-ink-3">No steelman yet</span>
        )}
      </span>
    </footer>
  );
}
