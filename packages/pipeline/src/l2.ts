/**
 * L2 critic runner + the auto-approval rule (UX §3: "auto-approval rules the
 * facilitator agreed to beforehand"). `criticEvents` and `approvalEvents` are
 * pure; `runL2` adds the model call.
 *
 * Approval rule (R0):
 * - Hard validator failures always block: they are structural (quote not found,
 *   a stance from a non-committing act, a rhetorical over-commitment, a held attribution).
 * - Soft validator flags (hedge, scope, new content) are shown to the critic; its
 *   verdict decides. The lexicons over-flag (evals/results.md), the critic doesn't.
 * - pass → approve; repair → apply the edit, then approve; reject → reject.
 * - Stances and ADUs follow their proposition; relations need both ends approved.
 */
import type { DomainEvent } from '@adl/core';
import { callStructured, type LlmCallLog } from '@adl/llm';
import { validateStance } from '@adl/ontology';
import { buildL2Input, L2_INSTRUCTIONS, L2_PROMPT_VERSION, L2Output, type CriticItem } from './prompts/l2-critic';
import type { Turn } from './turns';

export const HARD_VALIDATION_CODES = new Set([
  'span_missing_utterance',
  'span_out_of_range',
  'span_quote_mismatch',
  'non_attributable_stance',
  'non_committing_stance',
  'rhetorical_overcommitted',
  'attribution_pending',
]);

type Ev<T extends DomainEvent['type']> = Extract<DomainEvent, { type: T }>;

interface TurnItems {
  props: Ev<'proposition.proposed'>['payload']['proposition'][];
  stances: Ev<'stance.proposed'>['payload']['stance'][];
  adus: Map<string, Ev<'adu.proposed'>['payload']['adu']>;
  relations: Ev<'relation.proposed'>['payload']['relation'][];
  issues: Map<string, string[]>;
}

function collect(l1: DomainEvent[]): TurnItems {
  const out: TurnItems = { props: [], stances: [], adus: new Map(), relations: [], issues: new Map() };
  for (const e of l1) {
    if (e.type === 'proposition.proposed') out.props.push(e.payload.proposition);
    else if (e.type === 'stance.proposed') out.stances.push(e.payload.stance);
    else if (e.type === 'adu.proposed') out.adus.set(e.payload.adu.id, e.payload.adu);
    else if (e.type === 'relation.proposed') out.relations.push(e.payload.relation);
    else if (e.type === 'validation.result' && e.payload.issues.length) {
      // validation.result is keyed by proposition id (new) or stance id (existing proposition)
      const prev = out.issues.get(e.payload.itemId) ?? [];
      out.issues.set(e.payload.itemId, [...prev, ...e.payload.issues.map((i) => i.code)]);
    }
  }
  return out;
}

/** Items the critic judges: new propositions, and stances attached to existing ones. */
export function criticItems(l1: DomainEvent[], ctx: { names: Map<string, string>; index: Map<string, string> }): CriticItem[] {
  const t = collect(l1);
  const items: CriticItem[] = [];
  const stanceFor = (pid: string) => t.stances.find((s) => s.propositionId === pid);
  const describe = (s: TurnItems['stances'][number] | undefined) =>
    s ? { participantName: ctx.names.get(s.participantKey) ?? s.participantKey, attitude: s.attitude, strength: s.strength, source: s.source } : null;
  for (const p of t.props) {
    const s = stanceFor(p.id);
    const adu = s?.viaAduId ? t.adus.get(s.viaAduId) : undefined;
    items.push({
      itemId: p.id,
      canonical: p.canonical,
      type: p.type,
      scope: [p.scope.quantifier, p.scope.domain, p.scope.timeHorizon].filter(Boolean).join(', '),
      conditions: p.conditions,
      speechAct: adu?.speechAct ?? 'none',
      quotes: adu ? adu.spans.map((x) => x.quote) : [],
      stance: describe(s),
      validatorIssues: t.issues.get(p.id) ?? [],
    });
  }
  const newIds = new Set(t.props.map((p) => p.id));
  for (const s of t.stances) {
    if (newIds.has(s.propositionId)) continue;
    const adu = s.viaAduId ? t.adus.get(s.viaAduId) : undefined;
    items.push({
      itemId: s.id,
      canonical: ctx.index.get(s.propositionId) ?? s.propositionId,
      type: 'existing proposition',
      scope: '',
      conditions: [],
      speechAct: adu?.speechAct ?? 'none',
      quotes: adu ? adu.spans.map((x) => x.quote) : [],
      stance: describe(s),
      validatorIssues: t.issues.get(s.id) ?? [],
    });
  }
  return items;
}

/** critic.verdict (+ item.edited for canonical repairs) events. Strength repairs are resolved in approvalEvents. */
export function criticEvents(turn: Turn, out: L2Output, base: { sessionId: string; wallTs: string }): DomainEvent[] {
  const ev = { sessionId: base.sessionId, actor: 'system' as const, mediaMs: turn.endMs, wallTs: base.wallTs };
  const events: DomainEvent[] = [];
  for (const v of out.verdicts) {
    events.push({ ...ev, eventId: `${v.itemId}:critic`, type: 'critic.verdict', payload: { itemId: v.itemId, verdict: v.verdict, reason: `${v.rule}: ${v.reason}`, ...(v.repairedCanonical ? { repaired: v.repairedCanonical } : {}) } });
    if (v.verdict === 'repair' && v.repairedCanonical) {
      events.push({ ...ev, eventId: `${v.itemId}:repair`, type: 'item.edited', payload: { itemId: v.itemId, patch: { canonical: v.repairedCanonical }, reason: `critic repair (${v.rule})` } });
    }
  }
  return events;
}

/**
 * Apply the auto-approval rule to one turn's L1 events plus critic verdicts.
 * `approvedProps` holds previously approved proposition ids (for relations and
 * stances on existing propositions). Returns item.approved / item.rejected events,
 * with stance-strength repairs resolved to real stance ids.
 */
export function approvalEvents(
  turn: Turn,
  l1: DomainEvent[],
  verdicts: L2Output['verdicts'],
  approvedProps: ReadonlySet<string>,
  base: { sessionId: string; wallTs: string },
): DomainEvent[] {
  const ev = { sessionId: base.sessionId, actor: 'system' as const, mediaMs: turn.endMs, wallTs: base.wallTs };
  const t = collect(l1);
  const verdict = new Map(verdicts.map((v) => [v.itemId, v.verdict] as const));
  const hard = (id: string) => (t.issues.get(id) ?? []).some((c) => HARD_VALIDATION_CODES.has(c));
  const ok = (id: string) => !hard(id) && (verdict.get(id) === 'pass' || verdict.get(id) === 'repair');

  const out: DomainEvent[] = [];
  const approve = (itemId: string, note: string) => out.push({ ...ev, eventId: `${itemId}:auto-approved`, type: 'item.approved', payload: { itemId, note } });
  const reject = (itemId: string, reason: string) => out.push({ ...ev, eventId: `${itemId}:auto-rejected`, type: 'item.rejected', payload: { itemId, reason } });

  const approvedNow = new Set<string>();
  for (const p of t.props) {
    const anchored = t.stances.some(s => s.propositionId === p.id && s.viaAduId && (t.adus.get(s.viaAduId)?.spans.length ?? 0) > 0);
    if (anchored && ok(p.id)) {
      approve(p.id, 'auto: validators + critic');
      approvedNow.add(p.id);
    } else reject(p.id, !anchored ? 'auto: no surviving quote anchor' : hard(p.id) ? 'auto: hard validation failure' : `auto: critic ${verdict.get(p.id) ?? 'missing'}`);
  }
  const isApproved = (pid: string) => approvedNow.has(pid) || approvedProps.has(pid);
  const approvedAdus = new Set<string>();
  for (const s of t.stances) {
    const newProp = t.props.some((p) => p.id === s.propositionId);
    const good = newProp ? isApproved(s.propositionId) && !hard(s.propositionId) : ok(s.id) && isApproved(s.propositionId);
    if (good) {
      approve(s.id, 'auto: follows its proposition');
      if (s.viaAduId) approvedAdus.add(s.viaAduId);
    } else reject(s.id, 'auto: proposition or stance not approved');
  }
  for (const id of approvedAdus) approve(id, 'auto: carries an approved stance');
  for (const r of t.relations) {
    if (isApproved(r.fromId) && isApproved(r.toId)) approve(r.id, 'auto: both ends approved');
  }
  // Strength repairs: the critic addresses a proposition (or, for existing propositions, a stance) id.
  for (const v of verdicts) {
    if (v.verdict !== 'repair' || !v.repairedStrength) continue;
    const s = t.stances.find((x) => x.id === v.itemId) ?? t.stances.find((x) => x.propositionId === v.itemId);
    const adu = s?.viaAduId ? t.adus.get(s.viaAduId) : undefined;
    // The critic cannot override hard ontology constraints through a repair (notably
    // rhetorical questions, whose implied commitment is capped at leaning).
    if (s && adu && !validateStance(adu, { ...s, strength: v.repairedStrength }).some((i) => HARD_VALIDATION_CODES.has(i.code))) {
      out.push({ ...ev, eventId: `${s.id}:repair-strength`, type: 'item.edited', payload: { itemId: s.id, patch: { strength: v.repairedStrength }, reason: `critic repair (${v.rule})` } });
    }
  }
  return out;
}

export async function runL2(
  turn: Turn,
  l1: DomainEvent[],
  ctx: {
    sessionId: string;
    participants: { key: string; displayName: string }[];
    recentTurns: Turn[];
    index: Map<string, string>;
    wallTs: () => string;
  },
): Promise<{ events: DomainEvent[]; verdicts: L2Output['verdicts']; log: LlmCallLog | null; error?: string }> {
  const names = new Map(ctx.participants.map((p) => [p.key, p.displayName]));
  const items = criticItems(l1, { names, index: ctx.index });
  if (items.length === 0) return { events: [], verdicts: [], log: null };
  const result = await callStructured({
    pass: 'L2_critic',
    promptVersion: L2_PROMPT_VERSION,
    instructions: L2_INSTRUCTIONS,
    input: buildL2Input({
      participants: ctx.participants,
      recentTurns: ctx.recentTurns.slice(-2).map((t) => ({ speaker: names.get(t.participantKey) ?? t.participantKey, text: t.text })),
      turn: { speaker: names.get(turn.participantKey) ?? turn.participantKey, text: turn.text },
      items,
    }),
    schema: L2Output,
    sessionId: ctx.sessionId,
  });
  if (!result.ok) return { events: [], verdicts: [], log: result.log, error: `${result.reason}: ${result.detail}` };
  const expected = new Set(items.map(item => item.itemId));
  const seen = new Set<string>();
  const invalid = result.data.verdicts.length !== items.length || result.data.verdicts.some(v => {
    if (!expected.has(v.itemId) || seen.has(v.itemId)) return true;
    seen.add(v.itemId);
    return v.verdict === 'repair' && !v.repairedCanonical?.trim() && !v.repairedStrength;
  });
  if (invalid) return { events: [], verdicts: [], log: result.log, error: 'parse_error: critic must return exactly one verdict per requested item and a concrete change for every repair' };
  return { events: criticEvents(turn, result.data, { sessionId: ctx.sessionId, wallTs: ctx.wallTs() }), verdicts: result.data.verdicts, log: result.log };
}
