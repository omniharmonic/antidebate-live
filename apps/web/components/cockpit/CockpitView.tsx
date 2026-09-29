'use client';

/**
 * Facilitator cockpit (UX §3, Glance mode; DIRECTION §7). Dark, tablet landscape,
 * four fixed quadrants: the crux now, higher ground, already shared, try asking.
 * Shows the newest approved-or-sent card of each kind; nothing else. Audience
 * state and Blackout stay visible at all times. The quadrant bodies are also
 * used, compact, by the timeline's side panel for the state at the playhead.
 */
import { useEffect, useRef, useState } from 'react';
import type { DomainEvent, SessionState } from '@adl/core';
import { SessionBar } from '@/components/SessionBar';
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
import { operatorEventId, postOperatorEvents } from '@/lib/operator-events';
import { useSession } from '@/lib/session-context';

export function Cockpit({ sessionId }: { sessionId: string }) {
  const data = useSession();
  const { live: s, meta } = data;
  const round = s.round;
  void sessionId;

  return (
    <main data-surface="stage" className="cockpit-screen flex min-h-dvh flex-col bg-field text-ink">
      <div className="cockpit-header">
        <SessionBar meta={meta} current="cockpit" status={data.status} />
        <div className="cockpit-round-bar">
          <p className="min-w-0 text-[14px] text-ink-2">
            <span className="text-ink">{round?.name ?? 'Waiting for a round'}</span>
            {round ? <span className="ml-3 font-mono text-[12px]">{clock(s.lastMediaMs - round.startedMediaMs)} in round</span> : null}
          </p>
          <AudienceControl s={s} />
        </div>
        <nav className="cockpit-jumps" aria-label="Facilitator sections">
          <a href="#the-crux-now">Crux</a><a href="#higher-ground">Higher ground</a><a href="#already-shared">Shared</a><a href="#try-asking">Questions</a>
        </nav>
      </div>

      <div className="cockpit-grid grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2">
        <Quadrant title="The crux now" tag={currentCard(s, 'crux') ? <span className="text-ink-2">Candidate</span> : null} className="md:border-r">
          <CruxBody s={s} meta={meta} size="full" />
        </Quadrant>
        <Quadrant title="Higher ground" tag={currentCard(s, 'higher_ground') ? <span className="text-convergence">Candidate</span> : null}>
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

/** Audience state and Blackout. Acknowledged only when the event comes back through the log. */
function AudienceControl({ s }: { s: SessionState }) {
  const [pending, setPending] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const level = s.channels.stage.level;
  const label = s.blackout ? 'Audience: blackout' : level === 0 ? 'Audience: dark' : `Audience: stage level ${level}`;
  const waiting = pending !== null && pending !== s.blackout;
  const toggle = async () => {
    const on = !s.blackout;
    setPending(on);
    setError(null);
    const ev = { eventId: operatorEventId(s.sessionId), sessionId: s.sessionId, type: 'blackout.set', actor: 'operator', mediaMs: s.lastMediaMs, wallTs: new Date().toISOString(), payload: { on } } as DomainEvent;
    try {
      const res = await postOperatorEvents([ev]);
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
    } catch (err) {
      setPending(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <div className="audience-control flex items-center gap-3">
      <p className="text-[13px] text-ink-2" role="status" aria-live="polite" title={error ?? undefined}>
        {waiting ? 'Updating stage…' : error ? <span className="text-insight">Not sent. Try again.</span> : label}
      </p>
      <button
        type="button"
        onClick={toggle}
        disabled={waiting}
        aria-pressed={s.blackout}
        className={`h-11 shrink-0 rounded-[3px] border px-4 text-[14px] disabled:opacity-50 ${s.blackout ? 'border-ink bg-ink text-field' : 'border-border-2 text-ink hover:bg-field-deep'}`}
      >
        {s.blackout ? 'End blackout' : 'Blackout'}
      </button>
    </div>
  );
}

function Quadrant({ title, tag, className = '', children }: { title: string; tag?: React.ReactNode; className?: string; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const check = () => setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 6);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    el.addEventListener('scroll', check, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', check);
    };
  }, []);
  return (
    <section id={title.toLowerCase().replaceAll(' ', '-')} aria-label={title} className={`cockpit-quadrant flex min-h-0 flex-col border-b border-border px-5 pb-6 pt-6 md:px-8 ${className}`}>
      <div className="mb-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[22px] font-medium tracking-[-0.01em] text-ink">{title}</h2>
        {tag ? <p className="font-mono text-[14px]">{tag}</p> : null}
        {more ? (
          <button type="button" onClick={() => box.current?.scrollBy({ top: box.current.clientHeight * 0.8 })} className="hidden min-h-11 xl:block ml-auto text-[15px] text-ink-3 hover:text-ink">
            More below ↓
          </button>
        ) : null}
      </div>
      <div ref={box} className={`cockpit-content scroll-quiet min-h-0 flex-1 pr-2 ${more ? 'border-b border-border-2' : ''}`}>
        <div>{children}</div>
      </div>
    </section>
  );
}

type Size = 'full' | 'compact';

function Quiet({ children, size }: { children: React.ReactNode; size: Size }) {
  return <p className={`text-ink-3 ${size === 'full' ? 'text-[22px] leading-snug' : 'text-sm'}`}>{children}</p>;
}

/** Sources open and stay open until closed (DIRECTION §7: no auto-collapse mid-reading). */
function useExpand(resetKey: string | undefined) {
  const [open, setOpen] = useState<string | null>(null);
  const isOpen = open !== null && open === resetKey;
  return { isOpen, toggle: () => setOpen(isOpen ? null : (resetKey ?? null)) };
}

function SourcesButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={open} className="mt-5 inline-flex h-11 items-center gap-2 text-[17px] text-ink-2 underline decoration-border-2 underline-offset-4 hover:text-ink">
      {open ? 'Hide sources' : 'View sources'} <span aria-hidden>{open ? '↑' : '→'}</span>
    </button>
  );
}

export function CruxBody({ s, meta, size }: { s: SessionState; meta: SessionMeta; size: Size }) {
  const card = currentCard(s, 'crux');
  const { isOpen, toggle } = useExpand(card?.insight.id);
  if (!card) return <Quiet size={size}>No crux sent yet.</Quiet>;
  const b = card.body;
  const statement = canonical(s, b.propositionId) ?? b.statement;
  const full = size === 'full';
  const quoteFor = (stanceId: string, fallback: string) => {
    if (fallback) return fallback;
    const st = s.stances.get(stanceId)?.value;
    const adu = st?.viaAduId ? s.adus.get(st.viaAduId) : undefined;
    return adu ? adu.value.spans.map((x) => x.quote).join(' … ') : '';
  };
  return (
    <div key={card.insight.id} className="arrive">
      <p className={full ? 'text-[30px] xl:text-[34px] font-medium leading-[1.22] tracking-[-0.015em] text-ink' : 'text-[17px] font-medium leading-snug text-ink'}>{statement}</p>
      <ul className={`mt-5 space-y-2.5 ${full ? 'text-[21px]' : 'text-sm'}`}>
        {b.sides.map((side) => (
          <li key={side.participantKey + side.stanceId} className="flex items-baseline gap-3">
            <span aria-hidden className={`inline-block shrink-0 ${full ? 'h-5 w-1.5' : 'h-3 w-1'} translate-y-[3px]`} style={{ background: voiceColor(meta, side.participantKey) }} />
            <span className="text-ink">{personOf(meta, side.participantKey).displayName}</span>
            <span className="text-ink-2">
              {side.via ? (
                <>
                  {side.via.relation === 'undercuts' ? 'undercuts it' : 'rejects it'}, via: <span className="text-ink">&lsquo;{canonical(s, side.via.propositionId) ?? side.via.statement}&rsquo;</span>
                </>
              ) : (
                <>
                  {ATTITUDE_LABEL[side.attitude]} · {side.strength}
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className={`mt-4 text-ink-3 ${full ? 'text-[18px]' : 'text-xs'}`}>
        Settles by {SETTLING_LABEL[b.settlingEvidence]}
        {b.basis === 'clash' ? ' · inferred from opposing claims' : ''}
      </p>
      {full ? (
        <>
          <SourcesButton open={isOpen} onClick={toggle} />
          {isOpen ? (
            <div className="arrive mt-3 space-y-4 text-[19px] leading-snug">
              {b.sides.map((side) => {
                const q = quoteFor(side.stanceId, side.quote);
                const cond = b.updateConditions[side.participantKey];
                return (
                  <div key={'q' + side.participantKey} className="border-l-2 pl-4" style={{ borderColor: voiceColor(meta, side.participantKey) }}>
                    <p className="text-[15px] text-ink-3">{personOf(meta, side.participantKey).displayName}</p>
                    {q ? <p className="text-ink">&ldquo;{q}&rdquo;</p> : <p className="text-ink-3">Source span unavailable.</p>}
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
  if (!card) return <Quiet size={size}>No higher-ground candidate sent yet.</Quiet>;
  const b = card.body;
  const full = size === 'full';
  return (
    <div key={card.insight.id} className="arrive">
      <p className={full ? 'text-[28px] xl:text-[30px] font-medium leading-[1.25] tracking-[-0.015em] text-ink' : 'text-[16px] font-medium leading-snug text-ink'}>{b.text}</p>
      <ul className={`mt-4 space-y-2 ${full ? 'text-[20px] leading-snug' : 'text-sm'}`}>
        {Object.entries(b.costs).map(([k, cost]) => (
          <li key={k} className="flex items-baseline gap-3">
            <span aria-hidden className={`inline-block shrink-0 ${full ? 'h-4 w-1.5' : 'h-3 w-1'} translate-y-[2px]`} style={{ background: voiceColor(meta, k) }} />
            <span>
              <span className="text-ink-3">{personOf(meta, k).displayName} gives up:</span> <span className="text-ink-2">{cost}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className={`mt-4 text-convergence ${full ? 'text-[17px]' : 'text-xs'}`}>
        {CONSTRUCTION_LABEL[b.construction]} · not confirmed by participants
        {b.reliesOnInferred ? ' · relies on an inferred link' : ''}
      </p>
      {full ? (
        <>
          <SourcesButton open={isOpen} onClick={toggle} />
          {isOpen ? (
            <div className="arrive mt-3 space-y-4 text-[18px] leading-snug">
              {Object.entries(b.derivation).map(([k, ids]) => (
                <div key={'d' + k} className="border-l-2 pl-4" style={{ borderColor: voiceColor(meta, k) }}>
                  <p className="text-[15px] text-ink-3">Built from what {personOf(meta, k).displayName} accepts</p>
                  {ids.map((id) => (
                    <p key={id} className="mt-1 text-ink">
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
  const { isOpen, toggle } = useExpand(card?.insight.id ?? 'computed');
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
  const converging = (card?.body.converging ?? []).slice(-3).reverse();
  const full = size === 'full';
  if (groups.length === 0 && converging.length === 0) return <Quiet size={size}>No shared proposition identified yet.</Quiet>;
  const max = full ? (converging.length ? 3 : 5) : 3;
  const total = groups.reduce((n, g) => n + g.ids.length, 0);
  let shown = 0;
  const quote = (pid: string, key: string) => {
    for (const t of s.stances.values()) {
      const st = t.value;
      if (st.propositionId !== pid || st.participantKey !== key || !st.viaAduId) continue;
      const adu = s.adus.get(st.viaAduId);
      if (adu) return adu.value.spans.map((x) => x.quote).join(' … ');
    }
    return null;
  };
  const [pa, pb] = meta.sides;
  return (
    <div key={card?.insight.id ?? 'computed'} className="arrive">
      {groups.map((g) => (
        <div key={g.label} className="mb-3">
          {g.label && groups.length > 1 ? <p className={`mb-1 text-ink-3 ${full ? 'text-[16px]' : 'text-xs'}`}>{g.label}</p> : null}
          <ul className={`space-y-3 ${full ? 'text-[22px] leading-[1.3]' : 'text-sm'}`}>
            {g.ids.map((id) => {
              if (shown >= max) return null;
              shown++;
              return (
                <li key={id} className="flex gap-3">
                  <span aria-hidden className={`inline-block shrink-0 ${full ? 'w-1' : 'w-0.5'} self-stretch`} style={{ background: 'var(--convergence)' }} />
                  <span>
                    <span className="text-ink">{canonical(s, id) ?? id}</span>
                    {full && isOpen ? (
                      <span className="mt-2 block space-y-1.5 text-[17px] leading-snug">
                        {[pa, pb].map((p) => {
                          if (!p) return null;
                          const q = quote(id, p.key);
                          return q ? (
                            <span key={p.key} className="block border-l-2 pl-3 text-ink-2" style={{ borderColor: voiceColor(meta, p.key) }}>
                              <span className="text-ink-3">{p.displayName}: </span>&ldquo;{q}&rdquo;
                            </span>
                          ) : null;
                        })}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {total > max ? <p className={`text-ink-3 ${full ? 'text-[16px]' : 'text-xs'}`}>and {total - max} more</p> : null}
      {computed ? <p className={`mt-2 text-ink-3 ${full ? 'text-[15px]' : 'text-xs'}`}>Both accept these, from their stated stances.</p> : null}
      {converging.length ? (
        <div className="mt-4">
          <p className={`text-convergence ${full ? 'text-[16px]' : 'text-xs'}`}>Converging · inferred from related claims</p>
          <ul className={`mt-2 space-y-3 ${full ? 'text-[19px] leading-snug' : 'text-sm'}`}>
            {converging.map((c) => (
              <li key={c.relationId} className="space-y-1 border-l border-convergence-soft pl-3">
                {c.ids.map((id, i) => (
                  <span key={id} className="block">
                    <span style={{ color: voiceColor(meta, c.holders[i]!) }}>{personOf(meta, c.holders[i]!).displayName.split(' ')[0]}:</span> <span className="text-ink-2">{canonical(s, id) ?? id}</span>
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {full && groups.length ? <SourcesButton open={isOpen} onClick={toggle} /> : null}
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
  if (prompts.length === 0) return <Quiet size={size}>No question sent yet.</Quiet>;
  const full = size === 'full';
  const i = Math.min(idx, prompts.length - 1);
  const p = prompts[i]!;
  const who = p.body.addresseeKey === 'both' ? 'Both' : personOf(meta, p.body.addresseeKey).displayName;
  const btn = 'h-11 min-w-[110px] rounded-[3px] border border-border-2 px-4 text-[17px] text-ink hover:bg-field-deep disabled:opacity-35';
  return (
    <div>
      <div key={p.insight.id} className="arrive">
        <p className={`flex items-center gap-2 text-ink-3 ${full ? 'text-[17px]' : 'text-xs'}`}>
          {p.body.addresseeKey !== 'both' ? <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: voiceColor(meta, p.body.addresseeKey) }} /> : null}
          To {who}
        </p>
        <p className={full ? 'mt-3 text-[28px] xl:text-[30px] font-medium leading-[1.25] tracking-[-0.015em] text-ink' : 'mt-1 text-[15px] leading-snug text-ink'}>{p.body.text}</p>
        {p.body.targets.length > 0 && full ? <p className="mt-4 text-[17px] leading-snug text-ink-3">About: {p.body.targets.map((id) => canonical(s, id)).filter(Boolean).slice(0, 1).join('')}</p> : null}
      </div>
      {prompts.length > 1 && full ? (
        <div className="mt-6 flex items-center gap-3 text-[17px] text-ink-3">
          <button type="button" className={btn} disabled={i === 0} onClick={() => setIdx(i - 1)}>
            Newer
          </button>
          <button type="button" className={btn} disabled={i >= prompts.length - 1} onClick={() => setIdx(i + 1)}>
            Older
          </button>
          <span className="ml-2 font-mono text-[15px] tabular">
            {i + 1} of {prompts.length}
          </span>
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
    <footer className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border-t border-border px-5 py-3 text-[14px] text-ink-2 md:px-8">
      <span title="Question speech acts in the map">
        Questions asked <span className="ml-1 font-mono text-ink tabular">{questions}</span>
      </span>
      <span title="Concession speech acts in the map">
        Concessions <span className="ml-1 font-mono text-ink tabular">{concessions}</span>
      </span>
      <span className="min-w-0 flex-1 truncate text-right">
        {steelman ? (
          <>
            Steelman: {personOf(meta, steelman.by).displayName}
            {steelman.of ? ` of ${personOf(meta, steelman.of).displayName}` : ''} <span className="ml-1 font-mono text-ink-3">{clock(steelman.atMs)}</span>
          </>
        ) : (
          <span className="text-ink-3">No steelman yet</span>
        )}
      </span>
    </footer>
  );
}

