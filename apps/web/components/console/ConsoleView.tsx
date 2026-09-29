'use client';

/**
 * Operator console (UX §4, simplified for R0): transcript with attribution,
 * extraction queue with validator and critic badges, insight cards, and round
 * control. Every action is an event POSTed to /api/events; the stream brings
 * the result back, so what you see is always the log.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DomainEvent, Insight, SessionState, Tracked } from '@adl/core';
import type { CruxCard, HigherGroundCard, PromptCard, Proposition, SharedCard } from '@adl/ontology';
import { SessionBar } from '@/components/SessionBar';
import { ATTITUDE_LABEL, clock, personOf, voiceColor, type SessionMeta } from '@/lib/derive';
import { operatorEventId, postOperatorEvents } from '@/lib/operator-events';
import { useSession } from '@/lib/session-context';

type Action = 'item.approved' | 'item.rejected' | 'item.sent_to_facilitator';

async function postEvents(events: DomainEvent[]): Promise<string | null> {
  try {
    const res = await postOperatorEvents(events);
    if (!res.ok) return ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`;
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

function opEvent(s: SessionState, type: DomainEvent['type'], payload: unknown): DomainEvent {
  return { eventId: operatorEventId(s.sessionId), sessionId: s.sessionId, type, actor: 'operator', mediaMs: s.lastMediaMs, wallTs: new Date().toISOString(), payload } as DomainEvent;
}

export function Console({ sessionId }: { sessionId: string }) {
  void sessionId;
  const data = useSession();
  const { live: s, meta } = data;
  const [pending, setPending] = useState<Record<string, Action>>({});
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<'transcript' | 'review' | 'insights'>('review');

  const act = async (itemId: string, type: Action) => {
    setPending((p) => ({ ...p, [itemId]: type }));
    const payload = type === 'item.rejected' ? { itemId, reason: 'operator' } : { itemId };
    const err = await postEvents([opEvent(s, type, payload)]);
    setError(err);
    setPending((p) => {
      const { [itemId]: _drop, ...rest } = p;
      void _drop;
      return rest;
    });
  };

  return (
    <main className="console-screen session-screen flex h-dvh flex-col bg-field text-ink">
      <SessionBar meta={meta} current="console" status={data.status} />
      {error ? (
        <p role="alert" className="border-b border-border bg-insight-faint px-6 py-2 text-sm">
          Action not saved: {error}
        </p>
      ) : null}
      <nav aria-label="Console panels" className="console-panel-tabs">
        {([['transcript', 'Transcript'], ['review', 'Review queue'], ['insights', 'Insights & rounds']] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={panel === id} onClick={() => setPanel(id)}>{label}</button>)}
      </nav>
      <div className="console-workspace" data-panel={panel}>
        <div className="console-panel" data-console-panel="transcript"><Transcript s={s} meta={meta} /></div>
        <div className="console-panel" data-console-panel="review"><Queue s={s} meta={meta} pending={pending} act={act} /></div>
        <div className="console-panel scroll-quiet overflow-y-auto border-border xl:border-l" data-console-panel="insights">
          <RoundControl s={s} meta={meta} onError={setError} />
          <Insights s={s} meta={meta} pending={pending} act={act} />
        </div>
      </div>
    </main>
  );
}

function Column({ title, aside, children, className = '' }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={`flex min-h-0 min-w-0 flex-1 flex-col ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3">
        <h2 className="font-sans text-sm font-medium text-ink-2">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Transcript({ s, meta }: { s: SessionState; meta: SessionMeta }) {
  const box = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase();
  const matching = needle ? s.utteranceOrder.filter((id) => { const u = s.utterances.get(id)!; return u.text.toLowerCase().includes(needle) || personOf(meta, u.participantKey).displayName.toLowerCase().includes(needle); }) : s.utteranceOrder;
  const ids = matching.slice(-300);
  const newest = ids.at(-1);
  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [newest]);
  return (
    <Column title="Transcript" aside={<span className="text-xs text-ink-3 tabular">{matching.length} {needle ? 'matches' : 'lines'}</span>}>
      <div className="border-b border-border px-4 py-3">
        <input type="search" aria-label="Search transcript" placeholder="Search words or speaker" value={search} onChange={(e) => { stick.current = false; setSearch(e.target.value); box.current?.scrollTo({top:0}); }} className="h-11 w-full min-w-0 rounded-[3px] border border-border bg-field px-3 text-[14px]" />
        {matching.length > 300 ? <p className="mt-2 text-[12px] text-ink-3">Showing the latest 300 {needle ? 'matches' : 'lines'}. Search to find an earlier moment.</p> : null}
      </div>
      <ol
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4"
      >
        {ids.length === 0 ? <li className="text-sm text-ink-3">{needle ? 'No transcript lines match. Try another word or speaker.' : 'Waiting for the first utterance.'}</li> : null}
        {ids.map((id) => {
          const u = s.utterances.get(id)!;
          const low = u.attribution.confidence < 0.8;
          return (
            <li key={id} className="text-[14px] leading-snug">
              <p className="flex items-baseline gap-2 text-xs">
                <span className="font-mono text-ink-3 tabular">{clock(u.startMs)}</span>
                <span className="font-medium" style={{ color: voiceColor(meta, u.participantKey) }}>
                  {personOf(meta, u.participantKey).displayName}
                </span>
                {low || s.pendingAttribution.has(id) ? (
                  <span className="font-mono text-insight" title="Attribution confidence">
                    attribution {u.attribution.confidence.toFixed(2)}
                  </span>
                ) : null}
              </p>
              <p className="mt-0.5">{u.text}</p>
            </li>
          );
        })}
      </ol>
    </Column>
  );
}

type Filter = 'review' | 'all' | 'issues' | 'rejected';

function StateBadge({ t }: { t: Tracked<unknown> }) {
  const label = t.state === 'proposed' ? 'proposed' : t.state;
  const tone = t.state === 'approved' || t.state === 'released' ? 'text-ink' : t.state === 'rejected' ? 'text-ink-3 line-through' : 'text-ink-2';
  return (
    <span className={`rounded border border-border px-1.5 py-px font-mono text-[11px] ${tone}`} style={t.state === 'approved' ? { borderColor: 'var(--ink-3)' } : undefined}>
      {label}
      {t.sentToFacilitator ? ' · sent' : ''}
    </span>
  );
}

function Checks({ t }: { t: Tracked<unknown> }) {
  return (
    <span className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
      {t.issues.length === 0 ? (
        <span className="text-ink-3">validators clean</span>
      ) : (
        t.issues.map((i, n) => (
          <span key={`${i.code}:${n}`} className="text-insight" title={i.message}>
            {i.code}
          </span>
        ))
      )}
      {t.critic ? (
        <span className={t.critic.verdict === 'pass' ? 'text-ink-3' : 'text-insight'} title={t.critic.reason}>
          critic {t.critic.verdict}
        </span>
      ) : null}
    </span>
  );
}

function Buttons({ id, t, pending, act, send = false }: { id: string; t: Tracked<unknown>; pending: Record<string, Action>; act: (id: string, a: Action) => void; send?: boolean }) {
  const busy = pending[id];
  const btn = 'min-h-11 rounded border border-border-2 px-2.5 py-1 text-xs hover:bg-field-deep disabled:opacity-40';
  const blocked = t.issues.length > 0;
  return (
    <span className="flex flex-wrap gap-1.5">
      <button
        type="button"
        className={btn}
        disabled={Boolean(busy) || t.state !== 'proposed'}
        title={t.state === 'rejected' ? 'Rejected items stay rejected; the log is append-only' : undefined}
        onClick={() => {
          if (blocked && !window.confirm('Validators flagged this item. Approve anyway? The override is logged.')) return;
          act(id, 'item.approved');
        }}
      >
        Approve
      </button>
      <button type="button" className={btn} disabled={Boolean(busy) || t.state === 'rejected'} onClick={() => act(id, 'item.rejected')}>
        Reject
      </button>
      {send ? (
        <button type="button" className={btn} disabled={Boolean(busy) || t.sentToFacilitator || t.state === 'rejected'} onClick={() => act(id, 'item.sent_to_facilitator')}>
          Send to facilitator
        </button>
      ) : null}
    </span>
  );
}

function Queue({ s, meta, pending, act }: { s: SessionState; meta: SessionMeta; pending: Record<string, Action>; act: (id: string, a: Action) => void }) {
  const [filter, setFilter] = useState<Filter>('review');
  const stancesByProp = useMemo(() => {
    const m = new Map<string, Tracked<import('@adl/ontology').Stance>[]>();
    for (const t of s.stances.values()) m.set(t.value.propositionId, [...(m.get(t.value.propositionId) ?? []), t]);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.eventCount]);
  const all = [...s.propositions.values()].reverse();
  const matches = (t: Tracked<Proposition>) =>
    filter === 'all' ? t.state !== 'merged' : filter === 'review' ? t.state === 'proposed' : filter === 'issues' ? t.issues.length > 0 || (t.critic && t.critic.verdict !== 'pass') : t.state === 'rejected';
  const shown = all.filter(matches).slice(0, 200);
  const counts: Record<Filter, number> = {
    review: all.filter((t) => t.state === 'proposed').length,
    all: all.filter((t) => t.state !== 'merged').length,
    issues: all.filter((t) => t.issues.length > 0 || (t.critic && t.critic.verdict !== 'pass')).length,
    rejected: all.filter((t) => t.state === 'rejected').length,
  };
  const LABEL: Record<Filter, string> = { review: 'Needs review', all: 'All', issues: 'Flagged', rejected: 'Rejected' };

  return (
    <Column
      title="Extraction queue"
      className="border-t border-border lg:border-l lg:border-t-0"
      aside={
        <div role="group" aria-label="Filter" className="flex gap-1 text-xs">
          {(['review', 'issues', 'all', 'rejected'] as Filter[]).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={`min-h-11 rounded px-2 py-0.5 ${filter === f ? 'bg-field-deep text-ink' : 'text-ink-3 hover:text-ink'}`}>
              {LABEL[f]} <span className="font-mono tabular">{counts[f]}</span>
            </button>
          ))}
        </div>
      }
    >
      <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
        {shown.length === 0 ? (
          <li className="px-5 py-4 text-sm text-ink-3">{filter === 'review' ? 'Nothing waiting for review.' : 'No items here.'}</li>
        ) : null}
        {shown.map((t) => {
          const p = t.value;
          const sts = stancesByProp.get(p.id) ?? [];
          return (
            <li
              key={p.id}
              tabIndex={0}
              className="px-5 py-3 outline-none focus-visible:bg-surface"
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === 'a') act(p.id, 'item.approved');
                if (e.key === 'r') act(p.id, 'item.rejected');
                if (e.key === 's') act(p.id, 'item.sent_to_facilitator');
              }}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
                <span className="font-mono">{p.id.split(':').slice(-2).join(':')}</span>
                <span>
                  {p.type} · {p.stratum}
                </span>
                <StateBadge t={t} />
                <Checks t={t} />
              </div>
              <p className={`mt-1 text-[16px] font-medium leading-snug ${t.state === 'rejected' ? 'text-ink-3 line-through' : ''}`}>{p.canonical}</p>
              <ul className="mt-1.5 space-y-1">
                {sts.map((st) => {
                  const adu = st.value.viaAduId ? s.adus.get(st.value.viaAduId)?.value : undefined;
                  return (
                    <li key={st.value.id} className="text-[13px] leading-snug">
                      <span className="font-medium" style={{ color: voiceColor(meta, st.value.participantKey) }}>
                        {personOf(meta, st.value.participantKey).displayName}
                      </span>{' '}
                      <span className="text-ink-2">
                        {ATTITUDE_LABEL[st.value.attitude]}, {st.value.strength}
                        {st.value.source !== 'stated' ? ` (${st.value.source.replaceAll('_', ' ')})` : ''}
                        {adu && adu.speechAct !== 'assert' ? ` · ${adu.speechAct.replaceAll('_', ' ')}` : ''}
                      </span>
                      {st.state === 'rejected' ? <span className="ml-1 text-ink-3">(stance rejected)</span> : null}
                      {adu ? <span className="mt-0.5 block text-ink-2">&ldquo;{adu.spans.map((x) => x.quote).join(' … ')}&rdquo;</span> : null}
                    </li>
                  );
                })}
              </ul>
              <div className="mt-2">
                <Buttons id={p.id} t={t} pending={pending} act={act} />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="border-t border-border px-5 py-2 text-xs text-ink-3">Focus an item and press a to approve, r to reject, s to send.</p>
    </Column>
  );
}

function insightText(s: SessionState, i: Insight): string {
  const b = i.body;
  switch (i.kind) {
    case 'crux': {
      const c = b as unknown as CruxCard;
      return s.propositions.get(c.propositionId)?.value.canonical ?? c.statement;
    }
    case 'higher_ground':
      return (b as unknown as HigherGroundCard).text;
    case 'prompt':
      return (b as unknown as PromptCard).text;
    case 'shared': {
      const c = b as unknown as SharedCard;
      const n = c.ends.length + c.facts.length + c.framings.length;
      return `${n} shared ${n === 1 ? 'proposition' : 'propositions'}`;
    }
    default:
      return typeof b.text === 'string' ? b.text : i.id;
  }
}

const KIND_LABEL: Record<string, string> = { crux: 'Crux', higher_ground: 'Higher ground', prompt: 'Prompt', shared: 'Shared', drift: 'Drift', steelman: 'Steelman', update: 'Update', question: 'Question' };

function Insights({ s, meta, pending, act }: { s: SessionState; meta: SessionMeta; pending: Record<string, Action>; act: (id: string, a: Action) => void }) {
  void meta;
  const list = [...s.insights.values()].reverse().slice(0, 60);
  return (
    <section aria-label="Insight cards">
      <h2 className="border-b border-border px-5 py-2.5 font-sans text-sm font-medium text-ink-2">Cards for the facilitator</h2>
      <ul className="divide-y divide-border">
        {list.length === 0 ? <li className="px-5 py-4 text-sm text-ink-3">No cards yet.</li> : null}
        {list.map((t) => (
          <li key={t.value.id} className="px-5 py-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
              <span className="font-medium text-ink-2">{KIND_LABEL[t.value.kind] ?? t.value.kind}</span>
              <StateBadge t={t} />
              <Checks t={t} />
            </div>
            <p className={`mt-1 text-[15px] leading-snug ${t.state === 'rejected' ? 'text-ink-3 line-through' : ''}`} style={t.value.kind === 'higher_ground' ? { color: 'var(--convergence)' } : undefined}>
              {insightText(s, t.value)}
            </p>
            <div className="mt-2">
              <Buttons id={t.value.id} t={t} pending={pending} act={act} send />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RoundControl({ s, meta, onError }: { s: SessionState; meta: SessionMeta; onError: (e: string | null) => void }) {
  const rounds = meta.format.rounds;
  const curIdx = s.round ? rounds.findIndex((r) => r.id === s.round!.roundId) : -1;
  const [choice, setChoice] = useState<string>('');
  const next = rounds[curIdx + 1];
  const selected = rounds.find((r) => r.id === choice) ?? next ?? rounds[0];
  const [busy, setBusy] = useState(false);

  const start = async () => {
    if (!selected) return;
    setBusy(true);
    const evs: DomainEvent[] = [];
    if (s.round) evs.push(opEvent(s, 'round.ended', { roundId: s.round.roundId }));
    evs.push(opEvent(s, 'round.started', { roundId: selected.id, name: selected.name, ...(selected.plannedMs ? { plannedMs: selected.plannedMs } : {}) }));
    onError(await postEvents(evs));
    setChoice('');
    setBusy(false);
  };
  const end = async () => {
    if (!window.confirm('End this session? The log stays; the session is marked ended.')) return;
    onError(await postEvents([opEvent(s, 'session.ended', {})]));
  };

  return (
    <section aria-label="Round control" className="border-b border-border px-5 py-4">
      <p className="text-sm text-ink-2">
        {s.round ? (
          <>
            Now: <span className="text-ink">{s.round.name}</span>{' '}
            <span className="font-mono text-xs text-ink-3 tabular">since {clock(s.round.startedMediaMs)}</span>
          </>
        ) : (
          'No round started.'
        )}
      </p>
      <div className="mt-3 flex gap-2">
        <label className="sr-only" htmlFor="round-select">
          Next round
        </label>
        <select
          id="round-select"
          value={selected?.id ?? ''}
          onChange={(e) => setChoice(e.target.value)}
          className="min-w-0 flex-1 rounded border border-border-2 bg-surface px-2 py-1.5 text-sm"
        >
          {rounds.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
              {r.optional ? ' (optional)' : ''}
            </option>
          ))}
        </select>
        <button type="button" onClick={start} disabled={busy || !selected || selected.id === s.round?.roundId} className="rounded border border-ink-3 px-3 py-1.5 text-sm hover:bg-field-deep disabled:opacity-40">
          Start round
        </button>
      </div>
      {s.ended ? (
        <p className="mt-3 text-xs text-ink-3">Session ended.</p>
      ) : (
        <button type="button" onClick={end} className="mt-3 text-xs text-ink-3 underline decoration-border underline-offset-2 hover:text-ink">
          End session
        </button>
      )}
    </section>
  );
}
