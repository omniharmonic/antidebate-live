/**
 * L4 insight (ONTOLOGY §4; UX §3): the crux now, higher ground, facilitator
 * prompts, and shared ground. The model chooses and phrases; code decides what is
 * true: the crux must be a ranked candidate (a real disagreement or clash), each
 * higher-ground derivation id must be in that participant's accepted commitments,
 * quotes are copied from spans, and shared ground is computed without a model.
 */
import { z } from 'zod';
import { getFormat, roundDef, type DomainEvent, type Insight } from '@adl/core';
import { callStructured, type LlmCallLog } from '@adl/llm';
import {
  HigherGroundConstruction,
  SettlingEvidence,
  type CruxCard,
  type HigherGroundCard,
  type PromptCard,
  type SharedCard,
} from '@adl/ontology';
import { focusIds, renderMap, similarity, type MapView } from './mapview';
import { reviewItems, reviewMap } from './review';

export const L4_PROMPT_VERSION = 'l4-insight-v0.4';

export const L4Output = z.object({
  crux: z
    .object({
      propositionId: z.string().describe('One id from CRUX CANDIDATES'),
      updateConditions: z.array(z.object({ participantKey: z.string(), wouldUpdateIf: z.string(), stanceId: z.string().nullable().default(null), quote: z.string().nullable().default(null) })),
      settlingEvidence: SettlingEvidence,
      valuesCrux: z.boolean(),
    })
    .nullable(),
  higherGround: z
    .array(
      z.object({
        text: z.string().describe('One sentence both could sign'),
        construction: HigherGroundConstruction,
        derivation: z.array(z.object({ participantKey: z.string(), propositionIds: z.array(z.string()) })),
        costs: z.array(z.object({ participantKey: z.string(), gives: z.string() })),
      }),
    )
    .describe('0–2 candidates'),
  prompts: z
    .array(
      z.object({
        text: z.string().describe('A question the facilitator can read aloud'),
        addresseeKey: z.string().describe("Participant key or 'both'"),
        kind: z.enum(['critical_question', 'crux_probe', 'drift_check', 'synthesis_test', 'inconsistency', 'open_question']),
        rationale: z.string(),
        targets: z.array(z.string()),
      }),
    )
    .describe('0–3 prompts, best first'),
});
export type L4Output = z.input<typeof L4Output>;

export const L4_INSTRUCTIONS = `You support the facilitator of an Anti-Debate: a format that first clarifies where two people really differ, then explores synthesis. You see the current argument map (every item is quote-anchored and was checked for faithfulness), the computed disagreements and crux candidates, and where the conversation is now. The facilitator reads your output on a tablet mid-conversation, at a glance. Clarity is the only goal; a card that muddles is worse than no card.

1. THE CRUX NOW. From CRUX CANDIDATES only, pick the one proposition that, if the two resolved it, would most move the rest of their disagreement as it stands now. Weigh how recently it was engaged: a crux settled or left behind earlier in the conversation is not the crux now. Prefer deep (values, epistemic) over surface, and stated over clash-based when close. For each debater, say what would make them update toward the other side, in their own terms and from what they have said (especially in red-teaming); if they haven't said, write "not stated". For every stated update condition give the stanceId and exact verbatim quote containing that condition from that participant; otherwise use null for stanceId and quote. Classify the settling evidence: empirical, forecast_resolution, value_clarification, definition. valuesCrux=true when it is value_clarification. Never choose a claim about a debater's own character, motives or biography; the crux is about the question being debated. Return null if no candidate is a real crux yet.

2. HIGHER GROUND (0–2). A sentence both debaters could sign, consistent with what each has committed to, integrating at least one element from each side. Name the construction (domain_partition, conditionalization, value_lift, incompletely_theorized_agreement, sequencing, pareto_move). derivation: for each debater, the ids of propositions THEY accept that the candidate relies on (at least one each; only ids listed as accepted by that person). costs: what each would have to qualify or give up, or "nothing". No candidate is better than a forced one. Never invent a concession or policy mechanism. Costs that are not established must say "not established; ask". A candidate is an invitation to test, never an agreement already reached.

3. TRY ASKING (0–3). Questions the facilitator could ask next, best first. Short, speakable, neutral, addressed to one debater or both. Draw them from: the crux (what evidence would move you?), unanswered critical questions of an argument, a term the two seem to use differently, a synthesis worth testing ("Could you both sign: …?"), or an inconsistency. Fit the current round: positions and clash early; steelman, update conditions and synthesis later. Never a verdict, never loaded.

Keep continuity: the facilitator is reading the tablet. If a previous card is still the best, return it with its text unchanged; only change a card when the conversation has actually moved. Use only ids from the map. Return only the JSON object required by the schema.`;

export interface PreviousCards {
  crux?: string;
  higherGround?: string[];
  prompts?: string[];
}

export function buildL4Input(
  v: MapView,
  ctx: { formatId: string; roundId: string | null; recent: { speaker: string; text: string }[]; previous: PreviousCards },
): string {
  const name = new Map(v.debaters.map((d) => [d.key, d.displayName]));
  const round = ctx.roundId ? roundDef(ctx.formatId, ctx.roundId) : undefined;
  const phase = round ? getFormat(ctx.formatId).phases.find((p) => p.id === round.phase)?.name : undefined;
  const dis = (list: MapView['disagreements'], label: string) =>
    list.map((d) => `${label} on ${d.propositionId} between ${d.participants.map((k) => name.get(k) ?? k).join(' and ')}`).join('\n');
  const cands = v.cruxCandidates.map((c) => `${c.propositionId} (score ${c.score}; ${c.basis}; grounds ${c.forDisagreements.length} disagreement(s); last engaged at ${Math.round(c.lastEngagedMs / 60000)} min)`).join('\n');
  const shared = v.commonGround.map((id) => `${id} ${v.props.get(id)?.canonical ?? ''}`).join('\n');
  const focus = focusIds(v, [], 70);
  const rels = v.relations
    .filter((r) => focus.has(r.fromId) && focus.has(r.toId))
    .map((r) => `${r.fromId} ${r.type} ${r.toId}${r.inferred ? ' (inferred)' : ''}`)
    .join('\n');
  const recent = ctx.recent.map((t) => `[${t.speaker}] ${t.text}`).join('\n');
  const prev = [
    ctx.previous.crux ? `crux: ${ctx.previous.crux}` : '',
    ...(ctx.previous.higherGround ?? []).map((h) => `higher ground: ${h}`),
    ...(ctx.previous.prompts ?? []).map((p) => `prompt: ${p}`),
  ]
    .filter(Boolean)
    .join('\n');
  return `DEBATERS: ${v.debaters.map((d) => `${d.key} = ${d.displayName}`).join('; ')}
FORMAT: ${getFormat(ctx.formatId).name}; ROUND NOW: ${round ? `${round.name} (${phase}; emphasis: ${round.pipelineEmphasis.join(', ') || 'none'})` : 'not detected'}

MAP (id [type/stratum] proposition — holders; the live part of the map):
${renderMap(v, { onlyIds: focus }) || '(empty)'}

RELATIONS:
${rels || '(none)'}

DISAGREEMENTS (stated: opposing stances on one proposition):
${dis(v.disagreements, 'stated') || '(none)'}
CLASHES (one side's claim attacks the other's):
${dis(v.clashes, 'clash') || '(none)'}

CRUX CANDIDATES (ranked in code):
${cands || '(none)'}

ALREADY SHARED (both accept):
${shared || '(none)'}

PREVIOUS CARDS:
${prev || '(none)'}

RECENT TRANSCRIPT:
${recent || '(none)'}`;
}

const accepted = (v: MapView, key: string, pid: string) => {
  const s = v.holders.get(pid)?.get(key);
  return s !== undefined && (s.attitude === 'accepts' || s.attitude === 'accepts_conditionally');
};

/** Validated cards. Invalid parts are dropped, never repaired by guesswork. */
export function insightCards(out: L4Output, v: MapView): { crux: CruxCard | null; higherGround: HigherGroundCard[]; prompts: PromptCard[] } {
  const keys = new Set(v.debaters.map((d) => d.key));
  // The model often answers with display names ("Shereef Bishay") instead of keys ("A").
  const byName = new Map(v.debaters.map((d) => [d.displayName.toLowerCase(), d.key]));
  const toKey = (x: string): string | null => {
    if (keys.has(x)) return x;
    const n = x.toLowerCase().trim();
    const exact = byName.get(n);
    if (exact) return exact;
    const firstNames = [...byName].filter(([full]) => full.split(' ')[0] === n);
    return firstNames.length === 1 ? firstNames[0]![1] : null;
  };
  let crux: CruxCard | null = null;
  const cand = out.crux ? v.cruxCandidates.find((c) => c.propositionId === out.crux!.propositionId) : undefined;
  const prop = cand ? v.props.get(cand.propositionId) : undefined;
  if (out.crux && cand && prop) {
    const sides: CruxCard['sides'] = [...(v.holders.get(prop.id)?.values() ?? [])].map((s) => ({
      participantKey: s.participantKey,
      attitude: s.attitude,
      strength: s.strength,
      quote: v.quotes.get(s.id) ?? '',
      stanceId: s.id,
    }));
    // Clash: add each other debater through the claim of theirs that attacks this one.
    for (const r of v.relations) {
      if (r.toId !== prop.id || !['rebuts', 'undercuts', 'undermines'].includes(r.type)) continue;
      for (const s of v.holders.get(r.fromId)?.values() ?? []) {
        if (sides.some((x) => x.participantKey === s.participantKey) || (s.attitude !== 'accepts' && s.attitude !== 'accepts_conditionally')) continue;
        sides.push({
          participantKey: s.participantKey,
          // This is the stance on the participant's own via claim. An undercut challenges
          // an inference; it does not establish rejection of its conclusion (§3).
          attitude: s.attitude,
          strength: s.strength,
          quote: v.quotes.get(s.id) ?? '',
          stanceId: s.id,
          via: { propositionId: r.fromId, statement: v.props.get(r.fromId)?.canonical ?? '', relation: r.type },
        });
      }
    }
    const disProp = new Map([...v.disagreements, ...v.clashes].map((d) => [d.id, d.propositionId]));
    const downstream = [...new Set(cand.forDisagreements.map((d) => disProp.get(d)).filter((id): id is string => !!id && id !== prop.id))];
    crux = {
      propositionId: prop.id,
      statement: prop.canonical,
      sides,
      updateConditions: Object.fromEntries(out.crux.updateConditions.flatMap((u) => { const k = toKey(u.participantKey);
        const stance = u.stanceId ? v.stances.find(s => s.id === u.stanceId) : undefined;
        const grounded = stance?.participantKey === k && u.quote && u.quote.trim().length >= 12 && (v.quotes.get(stance.id) ?? '').includes(u.quote);
        return k ? [[k, grounded ? u.wouldUpdateIf : 'not stated']] : []; })),
      settlingEvidence: out.crux.settlingEvidence,
      valuesCrux: out.crux.valuesCrux,
      downstream,
      score: cand.score,
      basis: cand.basis,
    };
  }

  if (crux && new Set(crux.sides.map(s => s.participantKey)).size < 2) crux = null;

  const higherGround: HigherGroundCard[] = [];
  for (const h of out.higherGround.slice(0, 2)) {
    const derivation: Record<string, string[]> = {};
    let valid = keys.size >= 2;
    for (const d of h.derivation) {
      const k = toKey(d.participantKey);
      if (!k || !d.propositionIds.length || d.propositionIds.some((id) => !v.props.has(id) || !accepted(v, k, id))) { valid = false; break; }
      const ids = d.propositionIds;
      if (ids.length) derivation[k] = [...(derivation[k] ?? []), ...ids];
    }
    // Must integrate an element from each debater's own commitments (§4.4).
    if (!valid || [...keys].some((k) => !derivation[k]?.length)) continue;
    const costs: Record<string, string> = {};
    for (const cost of h.costs) {
      const key = toKey(cost.participantKey);
      if (!key || !cost.gives.trim()) { valid = false; break; }
      costs[key] = cost.gives;
    }
    if (!valid || [...keys].some((k) => !costs[k])) continue;
    higherGround.push({
      text: h.text,
      construction: h.construction,
      derivation,
      costs,
      reliesOnInferred: false,
    });
  }

  const prompts: PromptCard[] = out.prompts.slice(0, 3).flatMap((p) => {
    const addressee = p.addresseeKey === 'both' ? 'both' : toKey(p.addresseeKey);
    if (!addressee || p.targets.some((id) => !v.props.has(id))) return [];
    return [{ text: p.text, addresseeKey: addressee, kind: p.kind, rationale: p.rationale, targets: p.targets }];
  });
  return { crux, higherGround, prompts };
}

/** Shared ground split by kind (§4.3). No model. */
export function sharedCard(v: MapView): SharedCard {
  const card: SharedCard = {
    ends: [],
    facts: [],
    framings: [],
    converging: v.convergences.map((c) => ({ ids: [...c.ids], holders: [...c.holders], relationId: c.relationId, inferred: c.inferred })),
  };
  for (const id of v.commonGround) {
    const t = v.props.get(id)?.type;
    if (t === 'normative' || t === 'prescriptive') card.ends.push(id);
    else if (t === 'definitional' || t === 'conceptual') card.framings.push(id);
    else card.facts.push(id);
  }
  return card;
}

/**
 * Keep cards stable across passes (the facilitator reads a tablet): drop a crux on the
 * proposition already shown, and higher ground or prompts nearly identical (word
 * overlap ≥ 0.7) to one emitted recently. The earlier card simply stays current.
 */
export function stableCards(
  cards: { crux: CruxCard | null; higherGround: HigherGroundCard[]; prompts: PromptCard[] },
  recent: { cruxPropositionId?: string; cruxFingerprint?: string; cruxHistory?: string[]; lastBlockedCrux?: string; higherGround: string[]; prompts: string[] },
): { crux: CruxCard | null; higherGround: HigherGroundCard[]; prompts: PromptCard[] } {
  const fresh = (text: string, seen: string[]) => !seen.some((s) => similarity(s, text) >= 0.7);
  const prompts = cards.prompts.filter((p) => fresh(p.text, recent.prompts));
  return {
    // Hysteresis: no repeat of the current crux, and no return to one of the last few (A → B → A ping-pong).
    // …unless the model proposes the same earlier crux twice running: then it is a considered return, not ping-pong.
    crux:
      cards.crux &&
      ((cards.crux.propositionId === recent.cruxPropositionId && (!recent.cruxFingerprint || recent.cruxFingerprint === JSON.stringify(cards.crux))) ||
        ((recent.cruxHistory ?? []).includes(cards.crux.propositionId) && recent.lastBlockedCrux !== cards.crux.propositionId))
        ? null
        : cards.crux,
    higherGround: cards.higherGround.filter((h) => fresh(h.text, recent.higherGround)),
    // Prompts come as a set of up to three; keep the set only if something in it is new.
    prompts: prompts.length ? cards.prompts : [],
  };
}

/** insight.proposed + item.approved events (cards passed code validation). */
export function insightEvents(
  cards: { crux: CruxCard | null; higherGround: HigherGroundCard[]; prompts: PromptCard[]; shared?: SharedCard },
  ctx: { sessionId: string; seq: number; mediaMs: number; wallTs: string },
): DomainEvent[] {
  const base = { sessionId: ctx.sessionId, actor: 'system' as const, mediaMs: ctx.mediaMs, wallTs: ctx.wallTs };
  const tag = `${ctx.sessionId}:l4:${String(ctx.seq).padStart(3, '0')}`;
  const events: DomainEvent[] = [];
  const emit = (suffix: string, kind: Insight['kind'], body: Record<string, unknown>, refs: string[]) => {
    const insight: Insight = { id: `${tag}:${suffix}`, kind, body, refs };
    events.push({ ...base, eventId: `${insight.id}:proposed`, type: 'insight.proposed', payload: { insight } });
    events.push({ ...base, eventId: `${insight.id}:approved`, type: 'item.approved', payload: { itemId: insight.id, note: 'auto: code-validated card' } });
  };
  if (cards.crux) emit('crux', 'crux', cards.crux, [cards.crux.propositionId, ...cards.crux.downstream]);
  cards.higherGround.forEach((h, i) => emit(`hg${i}`, 'higher_ground', h, Object.values(h.derivation).flat()));
  cards.prompts.forEach((p, i) => emit(`q${i}`, 'prompt', p, p.targets));
  if (cards.shared) emit('shared', 'shared', cards.shared, [...cards.shared.ends, ...cards.shared.facts, ...cards.shared.framings]);
  return events;
}

export async function runL4(
  v: MapView,
  ctx: {
    sessionId: string;
    seq: number;
    mediaMs: number;
    formatId: string;
    roundId: string | null;
    recent: { speaker: string; text: string }[];
    previous: PreviousCards;
    previousShared: string;
    recentCards?: { cruxPropositionId?: string; cruxFingerprint?: string; cruxHistory?: string[]; lastBlockedCrux?: string; higherGround: string[]; prompts: string[] };
    wallTs: () => string;
    onReviewCall?: (log: LlmCallLog) => void;
  },
): Promise<{ events: DomainEvent[]; log: LlmCallLog | null; error?: string; sharedKey: string }> {
  const shared = sharedCard(v);
  const sharedKey = JSON.stringify(shared);
  const sharedChanged = sharedKey !== ctx.previousShared;
  if (v.props.size === 0) return { events: [], log: null, sharedKey };
  const result = await callStructured({
    pass: 'L4_insight',
    promptVersion: L4_PROMPT_VERSION,
    instructions: L4_INSTRUCTIONS,
    input: buildL4Input(v, ctx),
    schema: L4Output,
    sessionId: ctx.sessionId,
  });
  const base = { sessionId: ctx.sessionId, seq: ctx.seq, mediaMs: ctx.mediaMs, wallTs: ctx.wallTs() };
  if (!result.ok) {
    const events = sharedChanged ? insightEvents({ crux: null, higherGround: [], prompts: [], shared }, base) : [];
    return { events, log: result.log, error: `${result.reason}: ${result.detail}`, sharedKey };
  }
  const raw = insightCards(result.data, v);
  const evidence = reviewMap(v);
  const candidates = [
    ...(raw.crux ? [{ id: 'crux', kind: 'crux', content: raw.crux, evidence }] : []),
    ...raw.higherGround.map((content, i) => ({ id: `hg${i}`, kind: 'higher_ground', content, evidence })),
    ...raw.prompts.map((content, i) => ({ id: `q${i}`, kind: 'prompt', content, evidence })),
  ];
  const review = await reviewItems(candidates, ctx.sessionId);
  if (review.log) ctx.onReviewCall?.(review.log);
  const passed = new Set(review.verdicts.filter(x => x.verdict === 'pass').map(x => x.id));
  const reviewed = { crux: passed.has('crux') ? raw.crux : null, higherGround: raw.higherGround.filter((_, i) => passed.has(`hg${i}`)), prompts: raw.prompts.filter((_, i) => passed.has(`q${i}`)) };
  const cards = ctx.recentCards ? stableCards(reviewed, ctx.recentCards) : reviewed;
  if (ctx.recentCards) ctx.recentCards.lastBlockedCrux = raw.crux && !cards.crux && raw.crux.propositionId !== ctx.recentCards.cruxPropositionId ? raw.crux.propositionId : undefined;
  return { events: insightEvents({ ...cards, ...(sharedChanged ? { shared } : {}) }, base), log: result.log, sharedKey, ...(review.error ? { error: `Independent review: ${review.error}` } : {}) };
}
