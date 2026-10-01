/**
 * L1 runner: turn → structured extraction → validated proposal events.
 * `mapL1Output` is pure and unit-tested; `runL1` adds the model call.
 */
import type { DomainEvent } from '@adl/core';
import { callStructured, type LlmCallLog } from '@adl/llm';
import {
  validateProposal,
  validateStance,
  type Adu,
  type Proposition,
  type Relation,
  type Stance,
  type Utterance,
} from '@adl/ontology';
import { L1_INSTRUCTIONS, L1_PROMPT_VERSION, L1Output, buildL1Input, buildSessionContext } from './prompts/l1-extract';
import { locateQuoteSpans } from './quotes';
import type { Turn } from './turns';

export interface L1Context {
  sessionId: string;
  participants: { key: string; displayName: string }[];
  round: string | null;
  recentTurns: Turn[];
  propositionIndex: { id: string; canonical: string; heldBy?: string }[];
  utterances: ReadonlyMap<string, Utterance>;
  wallTs: () => string;
}

export function mapL1Output(turn: Turn, out: L1Output, ctx: L1Context): DomainEvent[] {
  const base = { sessionId: ctx.sessionId, actor: 'system' as const, mediaMs: turn.endMs };
  const wall = ctx.wallTs();
  const events: DomainEvent[] = [];
  const id = (ref: string) => `${turn.turnId}:${ref}`;
  const existing = new Set(ctx.propositionIndex.map((p) => p.id));
  const resolveProp = (ref: string, local: Map<string, string>) => local.get(ref) ?? (existing.has(ref) ? ref : null);

  // ADUs: locate every quote exactly
  const adus = new Map<string, Adu>();
  const unlocated: { ref: string; quotes: string[] }[] = [];
  for (const a of out.adus) {
    const spans = a.quotes.map((q) => locateQuoteSpans(q, turn.utterances));
    if (spans.some((s) => s === null)) {
      unlocated.push({ ref: a.ref, quotes: a.quotes.filter((_, i) => spans[i] === null) });
      continue;
    }
    const adu: Adu = { id: id(a.ref), speakerKey: turn.participantKey, spans: spans.flatMap(s => s ?? []), speechAct: a.speechAct, addressedTo: a.addressedTo || 'none' };
    adus.set(a.ref, adu);
    events.push({ ...base, eventId: `${adu.id}:proposed`, type: 'adu.proposed', wallTs: wall, payload: { adu } });
  }
  for (const { ref, quotes } of unlocated) {
    events.push({ ...base, eventId: `${id(ref)}:unlocated`, type: 'validation.result', wallTs: wall, payload: { itemId: id(ref), issues: [{ code: 'span_quote_mismatch', message: `Model quote not found verbatim in turn; ADU dropped. Unmatched quotes: ${JSON.stringify(quotes)}` }] } });
  }

  // Propositions (new, or identity-resolved to existing)
  const localProp = new Map<string, string>();
  const props = new Map<string, Proposition>();
  for (const p of out.propositions) {
    if (p.sameAs && existing.has(p.sameAs)) {
      localProp.set(p.ref, p.sameAs);
      continue;
    }
    const prop: Proposition = {
      id: id(p.ref),
      canonical: p.canonical,
      type: p.type,
      stratum: p.stratum,
      scope: { quantifier: p.quantifier, ...(p.domain ? { domain: p.domain } : {}), ...(p.timeHorizon ? { timeHorizon: p.timeHorizon } : {}) },
      conditions: p.conditions,
      quantities: [],
      aboutConcepts: [],
      status: 'live_provisional',
    };
    localProp.set(p.ref, prop.id);
    props.set(prop.id, prop);
    events.push({ ...base, eventId: `${prop.id}:proposed`, type: 'proposition.proposed', wallTs: wall, payload: { proposition: prop } });
  }

  // Names, the rest of this turn and the context turns may supply resolved references
  // (prompt rule 3), so they count as antecedents for the new-content check.
  const antecedents = [...ctx.participants.map((p) => p.displayName), turn.text, ...ctx.recentTurns.map((t) => t.text)];

  // Stances, validated against their ADU and proposition (or ADU alone for an existing proposition)
  out.stances.forEach((s, i) => {
    const adu = adus.get(s.aduRef);
    const pid = resolveProp(s.propositionRef, localProp);
    if (!adu || !pid) return;
    const stance: Stance = {
      id: `${turn.turnId}:s${i}`,
      // L1 extracts the speaker's attitudes only; the model sometimes writes a display name here.
      participantKey: turn.participantKey,
      propositionId: pid,
      atMs: turn.endMs,
      viaAduId: adu.id,
      attitude: s.attitude,
      strength: s.strength,
      ...(s.credence !== null ? { credence: s.credence } : {}),
      source: adu.speechAct === 'concede' || adu.speechAct === 'rhetorical_question' ? 'implied_by_act' : 'stated',
    };
    events.push({ ...base, eventId: `${stance.id}:proposed`, type: 'stance.proposed', wallTs: wall, payload: { stance } });
    const prop = props.get(pid);
    const issues = prop
      ? validateProposal({ adu, proposition: prop, stance, utterances: ctx.utterances, resolvedAntecedents: antecedents })
      : validateStance(adu, stance);
    events.push({ ...base, eventId: `${stance.id}:validation`, type: 'validation.result', wallTs: wall, payload: { itemId: prop ? prop.id : stance.id, issues: issues.map(({ code, message }) => ({ code, message })) } });
  });

  // Relations
  out.relations.forEach((r, i) => {
    const from = resolveProp(r.fromRef, localProp);
    const to = resolveProp(r.toRef, localProp);
    if (!from || !to) return;
    const relation: Relation = { id: `${turn.turnId}:r${i}`, type: r.type, fromId: from, toId: to, ...(r.scheme ? { scheme: r.scheme } : {}), rationale: r.rationale, inferred: false, status: 'live_provisional' };
    events.push({ ...base, eventId: `${relation.id}:proposed`, type: 'relation.proposed', wallTs: wall, payload: { relation } });
  });

  return events;
}

export async function runL1(turn: Turn, ctx: L1Context): Promise<{ events: DomainEvent[]; log: LlmCallLog; error?: string }> {
  const result = await callStructured({
    pass: 'L1_extract',
    promptVersion: L1_PROMPT_VERSION,
    instructions: L1_INSTRUCTIONS,
    sessionContext: buildSessionContext(ctx.propositionIndex),
    input: buildL1Input({
      participants: ctx.participants,
      round: ctx.round,
      recentTurns: ctx.recentTurns.slice(-3).map((t) => ({ participantKey: t.participantKey, text: t.text })),
      turn: { participantKey: turn.participantKey, text: turn.text },
    }),
    schema: L1Output,
    sessionId: ctx.sessionId,
  });
  if (!result.ok) return { events: [], log: result.log, error: `${result.reason}: ${result.detail}` };
  return { events: mapL1Output(turn, result.data, ctx), log: result.log };
}
