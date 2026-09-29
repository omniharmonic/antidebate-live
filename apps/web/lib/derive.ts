/**
 * Pure derivations for the web surfaces. Everything here is computed from the
 * event log and the projected SessionState; nothing is stored or invented.
 */
import {
  apply,
  emptyState,
  getFormat,
  type DomainEvent,
  type EventOf,
  type FormatDef,
  type Insight,
  type Phase,
  type SessionState,
  type Tracked,
} from '@adl/core';
import { commitmentStores, commonGround, disagreements, type CommitmentStores } from '@adl/graph';
import type { CruxCard, HigherGroundCard, PromptCard, SharedCard, Stance } from '@adl/ontology';

/* ---------- projection (tolerant of event types added after this build) ---------- */

export function applySafe(s: SessionState, e: DomainEvent): SessionState {
  try {
    return apply(s, e);
  } catch {
    return s;
  }
}

/** State at media time t. Events are append-ordered, not media-ordered, so filter rather than break. */
export function projectAt(sessionId: string, events: readonly DomainEvent[], tMs: number): SessionState {
  let s = emptyState(sessionId);
  for (const e of events) if (e.mediaMs <= tMs) s = applySafe(s, e);
  return s;
}

/* ---------- session metadata ---------- */

export type SeatName = 'aff' | 'neg' | 'moderator' | 'audience';
export type VoiceSlot = 'a' | 'b' | 'mod' | 'other';

export interface Person {
  key: string;
  displayName: string;
  role: 'debater' | 'moderator' | 'audience';
  seat?: SeatName;
  voice: VoiceSlot;
}

export interface SessionMeta {
  sessionId: string;
  title: string;
  formatId: string;
  format: FormatDef;
  source: SessionState['source'];
  ended: boolean;
  people: Person[];
  /** The two sides in lane order: aff (or first debater) then neg (or second). */
  sides: [Person | undefined, Person | undefined];
}

export function sessionMeta(s: SessionState): SessionMeta {
  const seenKeys: string[] = [];
  if (s.participants.length === 0) {
    for (const id of s.utteranceOrder) {
      const k = s.utterances.get(id)?.participantKey;
      if (k && k !== 'UNK' && !seenKeys.includes(k)) seenKeys.push(k);
    }
  }
  const seats = s.seats ?? {};
  const base: Omit<Person, 'voice'>[] = s.participants.length
    ? s.participants.map((p) => ({ ...p, seat: seats[p.key] }))
    : seenKeys.map((k) => ({ key: k, displayName: k, role: 'debater' as const }));

  const debaters = base.filter((p) => p.role === 'debater');
  const aff = debaters.find((p) => p.seat === 'aff');
  const neg = debaters.find((p) => p.seat === 'neg');
  const rest = debaters.filter((p) => p !== aff && p !== neg);
  const first = aff ?? rest.shift();
  const second = neg ?? rest.shift();

  const people: Person[] = base.map((p) => ({
    ...p,
    voice: p === first ? 'a' : p === second ? 'b' : p.role === 'moderator' || p.seat === 'moderator' ? 'mod' : 'other',
  }));
  const formatId = s.formatId ?? 'open';
  return {
    sessionId: s.sessionId,
    title: s.title || s.sessionId,
    formatId,
    format: getFormat(formatId),
    source: s.source,
    ended: s.ended,
    people,
    sides: [people.find((p) => p.voice === 'a'), people.find((p) => p.voice === 'b')],
  };
}

export function personOf(meta: SessionMeta, key: string): Person {
  return meta.people.find((p) => p.key === key) ?? { key, displayName: key === 'UNK' ? 'Unattributed' : key, role: 'audience', voice: 'other' };
}

export const VOICE_VAR: Record<VoiceSlot, string> = { a: 'var(--voice-a)', b: 'var(--voice-b)', mod: 'var(--voice-mod)', other: 'var(--ink-3)' };
export const VOICE_FAINT_VAR: Record<VoiceSlot, string> = { a: 'var(--voice-a-faint)', b: 'var(--voice-b-faint)', mod: 'var(--field-deep)', other: 'var(--field-deep)' };
export const voiceColor = (meta: SessionMeta, key: string) => VOICE_VAR[personOf(meta, key).voice];

/* ---------- visibility ---------- */

const DEAD = new Set(['rejected', 'merged', 'retracted']);
export const isLive = (t: Tracked<unknown>) => !DEAD.has(t.state);
/** Cockpit rule (R0_DEMO): approved (incl. auto-approval) or sent to the facilitator, never rejected. */
export const cockpitVisible = (t: Tracked<unknown>) => isLive(t) && (t.state === 'approved' || t.state === 'released' || Boolean(t.sentToFacilitator));

export type CardKind = 'crux' | 'higher_ground' | 'shared' | 'prompt';
export interface CardOf {
  crux: CruxCard;
  higher_ground: HigherGroundCard;
  shared: SharedCard;
  prompt: PromptCard;
}

export interface CurrentCard<K extends CardKind> {
  insight: Insight;
  body: CardOf[K];
  tracked: Tracked<Insight>;
}

/** Newest cockpit-visible insight of a kind ("now"); earlier ones are history. */
export function currentCard<K extends CardKind>(s: SessionState, kind: K): CurrentCard<K> | null {
  let found: Tracked<Insight> | null = null;
  for (const t of s.insights.values()) if (t.value.kind === kind && cockpitVisible(t)) found = t;
  return found ? { insight: found.value, body: found.value.body as unknown as CardOf[K], tracked: found } : null;
}

/** The L4 pass an insight came from: ids look like `<session>:l4:<seq>:<suffix>`. */
export function insightPass(id: string): string | null {
  const m = /:l4:(\d+):[^:]+$/.exec(id);
  return m ? m[1]! : null;
}

/** Cockpit-visible prompts from the newest insight pass that produced any (best first); else the newest `limit`. */
export function visiblePrompts(s: SessionState, limit = 3): CurrentCard<'prompt'>[] {
  const all: CurrentCard<'prompt'>[] = [];
  for (const t of s.insights.values()) if (t.value.kind === 'prompt' && cockpitVisible(t)) all.push({ insight: t.value, body: t.value.body as unknown as PromptCard, tracked: t });
  const newestPass = all.length ? insightPass(all.at(-1)!.insight.id) : null;
  if (newestPass !== null) return all.filter((c) => insightPass(c.insight.id) === newestPass).slice(0, limit);
  return all.reverse().slice(0, limit);
}

/* ---------- graph ---------- */

export function liveStances(s: SessionState): Stance[] {
  const out: Stance[] = [];
  for (const t of s.stances.values()) {
    if (!isLive(t)) continue;
    const p = s.propositions.get(t.value.propositionId);
    if (p && !isLive(p)) continue;
    out.push(t.value);
  }
  return out;
}

export interface GraphView {
  stores: CommitmentStores;
  disagreements: ReturnType<typeof disagreements>;
  shared: string[];
}

export function graphOf(s: SessionState, meta: SessionMeta): GraphView {
  const stores = commitmentStores(liveStances(s));
  const sideKeys = meta.sides.filter((p): p is Person => Boolean(p)).map((p) => p.key);
  return { stores, disagreements: disagreements(stores), shared: sideKeys.length >= 2 ? commonGround(stores, sideKeys) : [] };
}

export function canonical(s: SessionState, id: string): string | null {
  return s.propositions.get(id)?.value.canonical ?? null;
}

/** Verbatim quote(s) behind a stance, via its ADU's spans. */
export function stanceQuote(s: SessionState, st: Stance): string | null {
  if (!st.viaAduId) return null;
  const adu = s.adus.get(st.viaAduId);
  return adu ? adu.value.spans.map((sp) => sp.quote).join(' … ') : null;
}

/* ---------- timeline (arc) ---------- */

export interface Band {
  phase: Phase | 'none';
  name: string;
  startMs: number;
  endMs: number;
}
export interface RoundMark {
  roundId: string;
  name: string;
  phase: Phase | null;
  startMs: number;
  endMs: number;
}

export function roundsOf(events: readonly DomainEvent[], meta: SessionMeta, endMs: number): { rounds: RoundMark[]; bands: Band[] } {
  const starts = events
    .filter((e): e is EventOf<'round.started'> => e.type === 'round.started')
    .map((e) => ({ roundId: e.payload.roundId, name: e.payload.name, startMs: e.mediaMs }))
    .sort((a, b) => a.startMs - b.startMs);
  const rounds: RoundMark[] = starts.map((r, i) => ({
    ...r,
    phase: meta.format.rounds.find((d) => d.id === r.roundId)?.phase ?? null,
    endMs: starts[i + 1]?.startMs ?? Math.max(endMs, r.startMs),
  }));
  if (rounds.length === 0) {
    const only = meta.format.phases.length === 1 ? meta.format.phases[0]!.name : 'No rounds marked';
    return { rounds, bands: [{ phase: 'none', name: only, startMs: 0, endMs }] };
  }
  const bands: Band[] = [];
  const first = rounds[0]!;
  if (first.startMs > 0) bands.push({ phase: 'none', name: 'Before the first round', startMs: 0, endMs: first.startMs });
  for (const r of rounds) {
    const phase = r.phase ?? 'none';
    const last = bands.at(-1);
    if (last && last.phase === phase && phase !== 'none') last.endMs = r.endMs;
    else bands.push({ phase, name: meta.format.phases.find((p) => p.id === r.phase)?.name ?? r.name, startMs: r.startMs, endMs: r.endMs });
  }
  return { rounds, bands };
}

export interface TimedStance {
  stance: Stance;
  tMs: number;
}

export interface Interval {
  propositionId: string;
  startMs: number;
  endMs: number | null;
}

/**
 * Walk stances in media order and record when each proposition becomes (and stops
 * being) a disagreement between the two sides, or shared ground. Uses the same
 * @adl/graph rules as the cockpit, one proposition at a time.
 */
export function groundOverTime(stances: Stance[], sideKeys: [string, string] | null): { disputes: Interval[]; shared: Interval[] } {
  const disputes: Interval[] = [];
  const shared: Interval[] = [];
  if (!sideKeys) return { disputes, shared };
  const [a, b] = sideKeys;
  const sorted = stances.filter((s) => s.source !== 'inferred').sort((x, y) => x.atMs - y.atMs);
  const latest = new Map<string, Map<string, Stance>>([
    [a, new Map()],
    [b, new Map()],
  ]);
  const openD = new Map<string, Interval>();
  const openS = new Map<string, Interval>();
  for (const st of sorted) {
    const store = latest.get(st.participantKey);
    if (!store) continue;
    store.set(st.propositionId, st);
    const sa = latest.get(a)!.get(st.propositionId);
    const sb = latest.get(b)!.get(st.propositionId);
    if (!sa || !sb) continue;
    const mini: CommitmentStores = new Map([
      [a, new Map([[st.propositionId, sa]])],
      [b, new Map([[st.propositionId, sb]])],
    ]);
    const isD = disagreements(mini).length > 0;
    const isS = commonGround(mini, [a, b]).length > 0;
    const track = (open: Map<string, Interval>, list: Interval[], on: boolean) => {
      const cur = open.get(st.propositionId);
      if (on && !cur) {
        const iv = { propositionId: st.propositionId, startMs: st.atMs, endMs: null };
        open.set(st.propositionId, iv);
        list.push(iv);
      } else if (!on && cur) {
        cur.endMs = st.atMs;
        open.delete(st.propositionId);
      }
    };
    track(openD, disputes, isD);
    track(openS, shared, isS);
  }
  return { disputes, shared };
}

export interface InsightMoment {
  id: string;
  kind: Insight['kind'];
  tMs: number;
  tracked: Tracked<Insight> | undefined;
}

export function insightMoments(events: readonly DomainEvent[], finalState: SessionState): InsightMoment[] {
  const out: InsightMoment[] = [];
  for (const e of events) {
    if (e.type !== 'insight.proposed') continue;
    const tracked = finalState.insights.get(e.payload.insight.id);
    if (tracked && !isLive(tracked)) continue;
    out.push({ id: e.payload.insight.id, kind: e.payload.insight.kind, tMs: e.mediaMs, tracked });
  }
  return out;
}

export function endOf(s: SessionState): number {
  let end = s.lastMediaMs;
  const last = s.utteranceOrder.at(-1);
  if (last) end = Math.max(end, s.utterances.get(last)?.endMs ?? 0);
  return end;
}

/* ---------- formatting ---------- */

export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export const ATTITUDE_LABEL: Record<Stance['attitude'], string> = {
  accepts: 'accepts',
  rejects: 'rejects',
  suspends: 'suspends judgment',
  accepts_conditionally: 'accepts, with conditions',
  accepts_for_argument: 'accepts for argument',
};

export const SETTLING_LABEL: Record<CruxCard['settlingEvidence'], string> = {
  empirical: 'evidence',
  forecast_resolution: 'waiting to see what happens',
  value_clarification: 'clarifying values',
  definition: 'agreeing on a definition',
};

export const CONSTRUCTION_LABEL: Record<HigherGroundCard['construction'], string> = {
  domain_partition: 'Splits the domain',
  conditionalization: 'Makes it conditional',
  value_lift: 'Lifts to a shared value',
  incompletely_theorized_agreement: 'Agrees on the what, not the why',
  sequencing: 'Sequences the steps',
  pareto_move: 'Better for both',
};
