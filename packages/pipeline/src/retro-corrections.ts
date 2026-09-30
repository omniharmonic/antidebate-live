/** Deterministic, idempotent corrections for saved recordings. Never calls a model. */
import { apply, project, type DomainEvent } from '@adl/core';
import { CruxCard, validateSpan, validateStance } from '@adl/ontology';

const active = (state: string) => state === 'approved' || state === 'released';
export function structuralCorrections(events: DomainEvent[], wallTs: string): DomainEvent[] {
  if (!events.length) return [];
  const sessionId = events[0]!.sessionId;
  const s = project(sessionId, events);
  const out: DomainEvent[] = [];
  const known = new Set(events.map(e => e.eventId));
  const at = new Map<string, number>();
  for (const e of events) {
    if (e.type === 'stance.proposed') at.set(e.payload.stance.id, e.mediaMs);
    if (e.type === 'proposition.proposed') at.set(e.payload.proposition.id, e.mediaMs);
    if (e.type === 'insight.proposed') at.set(e.payload.insight.id, e.mediaMs);
  }
  const emit = (id: string, action: 'edit' | 'reject', patch: Record<string, unknown>, reason: string) => {
    const eventId = `${sessionId}:qa-release-v1:${id}:${action}`;
    if (known.has(eventId)) return;
    const base = { eventId, sessionId, wallTs, mediaMs: at.get(id) ?? s.lastMediaMs, actor: 'system' as const };
    const e: DomainEvent = action === 'edit'
      ? { ...base, type: 'item.edited', payload: { itemId: id, patch, reason } }
      : { ...base, type: 'item.rejected', payload: { itemId: id, reason } };
    out.push(e); apply(s, e);
  };
  for (const st of s.stances.values()) {
    if (!active(st.state)) continue;
    const adu = st.value.viaAduId ? s.adus.get(st.value.viaAduId)?.value : undefined;
    if (!adu || !adu.spans.length || adu.spans.some(span => validateSpan(span, s.utterances).length)) {
      emit(st.value.id, 'reject', {}, 'QA: stance has no valid verbatim quote anchor'); continue;
    }
    const issues = validateStance(adu, st.value);
    if (issues.some(i => ['non_attributable_stance', 'non_committing_stance'].includes(i.code))) {
      emit(st.value.id, 'reject', {}, 'QA: this speech act does not commit the speaker');
    } else if (issues.some(i => i.code === 'rhetorical_overcommitted')) {
      emit(st.value.id, 'edit', { strength: 'leaning' }, 'QA: ontology §8.6 caps rhetorical implied commitment at leaning');
    }
  }
  for (const p of s.propositions.values()) {
    if (!active(p.state)) continue;
    const anchored = [...s.stances.values()].some(st => st.value.propositionId === p.value.id && active(st.state));
    if (!anchored) emit(p.value.id, 'reject', {}, 'QA: proposition has no surviving quote-anchored stance');
  }
  for (const i of s.insights.values()) {
    if (i.value.kind !== 'crux' || !active(i.state)) continue;
    const parsed = CruxCard.safeParse(i.value.body);
    if (!parsed.success) continue; // Unknown historical formats need separate review, not a guessed rewrite.
    let changed = false;
    const sides = parsed.data.sides.map(side => {
      const st = s.stances.get(side.stanceId)?.value;
      if (!st || st.participantKey !== side.participantKey || (side.attitude === st.attitude && side.strength === st.strength)) return side;
      changed = true;
      return { ...side, attitude: st.attitude, strength: st.strength };
    });
    if (changed) emit(i.value.id, 'edit', { body: { ...i.value.body, sides } }, 'QA: each crux side carries the stance and strength on its own cited claim; an attack does not imply rejection of its conclusion');
  }
  return out;
}
