/**
 * L3 link (ARCHITECTURE §3.1, §3.4): identity resolution and cross-turn,
 * cross-speaker relations over the approved map. Everything the model proposes is
 * checked in code: ids must exist, merges must join a newer proposition into an
 * older one, and relations it adds are marked `inferred` (the speaker did not draw
 * them). Crux ranking discounts inferred links (packages/graph/src/crux.ts).
 */
import { z } from 'zod';
import type { DomainEvent } from '@adl/core';
import { callStructured, type LlmCallLog } from '@adl/llm';
import type { Attitude } from '@adl/ontology';
import { focusIds, renderMap, type MapView } from './mapview';

export const L3_PROMPT_VERSION = 'l3-link-v0.2';

export const L3Output = z.object({
  merges: z.array(
    z.object({
      fromId: z.string().describe('The NEW proposition id'),
      intoId: z.string().describe('The existing proposition it duplicates'),
      polarity: z.enum(['same', 'negated']).describe('same: identical truth conditions; negated: fromId is exactly the negation of intoId'),
      reason: z.string(),
    }),
  ),
  relations: z.array(
    z.object({
      type: z.enum(['supports', 'rebuts', 'undercuts', 'undermines', 'qualifies', 'agrees', 'exemplifies']),
      fromId: z.string(),
      toId: z.string(),
      reason: z.string().describe('One sentence: why the content of fromId bears on toId'),
    }),
  ),
});
export type L3Output = z.infer<typeof L3Output>;

export const L3_INSTRUCTIONS = `You maintain the argument map of a live debate. Propositions are neutral sentences; each lists who holds it and how. Some are NEW since your last pass.

TASK 1 — identity. Two speakers often state the same claim in different words; merging them is what lets the map show where they agree and disagree. For each NEW proposition, is it the same claim as an existing one — a careful reader would say both sentences assert the same thing, with the same scope (quantifier, domain, time frame) and modality ("same")? Or is it exactly the negation of an existing one ("negated": e.g. "Labs should not need licenses" vs "Labs should be licensed")? Paraphrase counts as identity. Mere topic overlap, one being a special case or stronger version of the other, or a change of hedge from "might" to "will" does NOT. Prefer merging a NEW claim into an older claim held by a different speaker.

TASK 2 — links across speakers and turns. Add a relation only when the content of one proposition directly bears on another and the map would be misleading without it:
- rebuts: if fromId is true, toId is false or much less likely.
- undercuts: fromId attacks the inference from a premise to toId, not toId itself.
- undermines: fromId attacks a premise that toId rests on.
- supports: fromId being true makes toId more likely.
- qualifies / agrees / exemplifies: as named.
Relations are between contents, regardless of who holds them. Prefer links between different speakers' propositions and links involving NEW ones. Never duplicate a relation already listed. At most 8 relations; fewer is better.

Use only ids from the map. Return only the JSON object required by the schema.`;

export function buildL3Input(v: MapView, newIds: Set<string>): string {
  const focus = focusIds(v, newIds, 70);
  const existingRel = v.relations
    .filter((r) => focus.has(r.fromId) && focus.has(r.toId))
    .map((r) => `${r.fromId} ${r.type} ${r.toId}${r.inferred ? ' (inferred)' : ''}`)
    .join('\n');
  const all = renderMap(v, { onlyIds: focus })
    .split('\n')
    .map((l) => (newIds.has(l.split(' ')[0]!) ? `NEW ${l}` : `    ${l}`))
    .join('\n');
  return `PARTICIPANTS: ${v.debaters.map((d) => `${d.key} = ${d.displayName}`).join('; ')}\n\nPROPOSITIONS:\n${all}\n\nRELATIONS ALREADY IN THE MAP:\n${existingRel || '(none)'}`;
}

const FLIP: Partial<Record<Attitude, Attitude>> = { accepts: 'rejects', rejects: 'accepts', suspends: 'suspends' };

/** Validated merge / stance / relation events. `seq` makes event ids unique per pass. */
export function linkEvents(
  out: L3Output,
  v: MapView,
  newIds: Set<string>,
  ctx: { sessionId: string; seq: number; mediaMs: number; wallTs: string },
): DomainEvent[] {
  const base = { sessionId: ctx.sessionId, actor: 'system' as const, mediaMs: ctx.mediaMs, wallTs: ctx.wallTs };
  const tag = `${ctx.sessionId}:l3:${String(ctx.seq).padStart(3, '0')}`;
  const events: DomainEvent[] = [];
  const merged = new Set<string>();

  out.merges.forEach((m, i) => {
    if (!newIds.has(m.fromId) || !v.props.has(m.intoId) || newIds.has(m.intoId) || m.fromId === m.intoId || merged.has(m.fromId)) return;
    if (m.polarity === 'negated') {
      // Re-express each holder's stance on the surviving proposition, flipped.
      const holders = [...(v.holders.get(m.fromId)?.values() ?? [])];
      if (holders.some((s) => !FLIP[s.attitude])) return; // conditional acceptance can't be flipped safely
      holders.forEach((s, j) => {
        const stance = { ...s, id: `${tag}:m${i}s${j}`, propositionId: m.intoId, attitude: FLIP[s.attitude]! };
        events.push({ ...base, eventId: `${stance.id}:proposed`, type: 'stance.proposed', payload: { stance } });
        events.push({ ...base, eventId: `${stance.id}:approved`, type: 'item.approved', payload: { itemId: stance.id, note: `L3: negated duplicate of ${m.fromId}` } });
      });
    }
    events.push({ ...base, eventId: `${tag}:m${i}`, type: 'item.merged', payload: { fromId: m.fromId, intoId: m.intoId, ...(m.polarity === 'negated' ? { negated: true } : {}) } });
    merged.add(m.fromId);
  });

  const existing = new Set(v.relations.map((r) => `${r.fromId}|${r.type}|${r.toId}`));
  out.relations.slice(0, 8).forEach((r, i) => {
    if (!v.props.has(r.fromId) || !v.props.has(r.toId) || r.fromId === r.toId) return;
    if (merged.has(r.fromId) || merged.has(r.toId) || existing.has(`${r.fromId}|${r.type}|${r.toId}`)) return;
    const relation = { id: `${tag}:r${i}`, type: r.type, fromId: r.fromId, toId: r.toId, rationale: r.reason, inferred: true, status: 'live_provisional' as const };
    events.push({ ...base, eventId: `${relation.id}:proposed`, type: 'relation.proposed', payload: { relation } });
    events.push({ ...base, eventId: `${relation.id}:approved`, type: 'item.approved', payload: { itemId: relation.id, note: 'L3: inferred link' } });
  });
  return events;
}

export async function runL3(
  v: MapView,
  newIds: Set<string>,
  ctx: { sessionId: string; seq: number; mediaMs: number; wallTs: () => string },
): Promise<{ events: DomainEvent[]; log: LlmCallLog | null; error?: string }> {
  if (newIds.size === 0 || v.props.size < 2) return { events: [], log: null };
  const result = await callStructured({
    pass: 'L3_link',
    promptVersion: L3_PROMPT_VERSION,
    instructions: L3_INSTRUCTIONS,
    input: buildL3Input(v, newIds),
    schema: L3Output,
    sessionId: ctx.sessionId,
  });
  if (!result.ok) return { events: [], log: result.log, error: `${result.reason}: ${result.detail}` };
  return { events: linkEvents(result.data, v, newIds, { ...ctx, wallTs: ctx.wallTs() }), log: result.log };
}
