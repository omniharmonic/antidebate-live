/**
 * Pure, deterministic reducers. The same code runs in the worker, the browser
 * and playback. Never read clocks or randomness here.
 */
import type { DomainEvent } from './events';
import { emptyState, type SessionState, type Tracked } from './state';

function track<T>(value: T, wallTs: string): Tracked<T> {
  return { value, state: 'proposed', issues: [], proposedAtWall: wallTs };
}

/** Find any tracked item by id across collections. */
export function findItem(s: SessionState, id: string): Tracked<unknown> | undefined {
  return s.adus.get(id) ?? s.propositions.get(id) ?? s.stances.get(id) ?? s.relations.get(id) ?? s.insights.get(id);
}

export function apply(s: SessionState, e: DomainEvent): SessionState {
  s.eventCount += 1;
  s.lastEventId = e.eventId;
  s.lastMediaMs = Math.max(s.lastMediaMs, e.mediaMs);

  switch (e.type) {
    case 'session.started':
      s.title = e.payload.title;
      s.participants = e.payload.participants;
      s.formatId = e.payload.format;
      s.seats = e.payload.seats ?? {};
      s.source = e.payload.source ?? null;
      break;
    case 'session.ended':
      s.ended = true;
      break;
    case 'round.started':
      s.round = { roundId: e.payload.roundId, name: e.payload.name, startedMediaMs: e.mediaMs };
      break;
    case 'round.ended':
      if (s.round?.roundId === e.payload.roundId) s.round = null;
      break;
    case 'utterance.partial':
      break; // partials are console-only and never projected
    case 'utterance.final': {
      const u = e.payload.utterance;
      if (!s.utterances.has(u.id)) s.utteranceOrder.push(u.id);
      s.utterances.set(u.id, u);
      break;
    }
    case 'attribution.pending':
      s.pendingAttribution.add(e.payload.utteranceId);
      break;
    case 'attribution.confirmed': {
      s.pendingAttribution.delete(e.payload.utteranceId);
      const u = s.utterances.get(e.payload.utteranceId);
      if (u) {
        s.utterances.set(u.id, {
          ...u,
          participantKey: e.payload.participantKey,
          attribution: { ...u.attribution, confidence: 1, confirmedBy: 'operator' },
        });
      }
      break;
    }
    case 'turn.closed':
      break;
    case 'adu.proposed':
      s.adus.set(e.payload.adu.id, track(e.payload.adu, e.wallTs));
      break;
    case 'proposition.proposed':
      if (e.payload.sameAs && s.propositions.has(e.payload.sameAs)) break; // identity resolved to existing
      s.propositions.set(e.payload.proposition.id, track(e.payload.proposition, e.wallTs));
      break;
    case 'stance.proposed':
      s.stances.set(e.payload.stance.id, track(e.payload.stance, e.wallTs));
      break;
    case 'relation.proposed':
      s.relations.set(e.payload.relation.id, track(e.payload.relation, e.wallTs));
      break;
    case 'validation.result': {
      const it = findItem(s, e.payload.itemId);
      if (it) it.issues = e.payload.issues;
      break;
    }
    case 'critic.verdict': {
      const it = findItem(s, e.payload.itemId);
      if (it) it.critic = { verdict: e.payload.verdict, reason: e.payload.reason };
      break;
    }
    case 'insight.proposed':
      s.insights.set(e.payload.insight.id, track(e.payload.insight, e.wallTs));
      break;
    case 'item.approved': {
      const it = findItem(s, e.payload.itemId);
      if (it && it.state === 'proposed') it.state = 'approved';
      break;
    }
    case 'item.edited': {
      const it = findItem(s, e.payload.itemId);
      if (it && typeof it.value === 'object' && it.value !== null) it.value = { ...(it.value as object), ...e.payload.patch };
      break;
    }
    case 'item.rejected': {
      const it = findItem(s, e.payload.itemId);
      if (it) it.state = 'rejected';
      break;
    }
    case 'item.merged': {
      const { fromId, intoId, negated } = e.payload;
      const it = findItem(s, fromId);
      if (it) it.state = 'merged';
      if (s.propositions.has(fromId) && s.propositions.has(intoId)) {
        for (const st of s.stances.values()) {
          if (st.value.propositionId !== fromId) continue;
          if (negated) st.state = 'merged';
          else st.value = { ...st.value, propositionId: intoId };
        }
        for (const r of s.relations.values()) {
          if (r.value.fromId === fromId) r.value = { ...r.value, fromId: intoId };
          if (r.value.toId === fromId) r.value = { ...r.value, toId: intoId };
        }
      }
      break;
    }
    case 'item.sent_to_facilitator': {
      const it = findItem(s, e.payload.itemId);
      if (it) it.sentToFacilitator = true;
      break;
    }
    case 'dial.set': {
      const ch = s.channels[e.payload.channel];
      ch.level = e.payload.level;
      if (e.payload.toggles) ch.toggles = { ...ch.toggles, ...e.payload.toggles };
      if (e.payload.mode) ch.mode = e.payload.mode;
      break;
    }
    case 'release.published':
      for (const id of e.payload.itemIds) {
        const it = findItem(s, id);
        if (it && (it.state === 'approved' || it.state === 'released')) {
          it.state = 'released';
          it.releasedAtWall ??= e.wallTs;
        }
      }
      break;
    case 'release.retracted': {
      const it = findItem(s, e.payload.itemId);
      if (it) it.state = 'retracted';
      break;
    }
    case 'blackout.set':
      s.blackout = e.payload.on;
      break;
    case 'spotlight.set':
      s.channels[e.payload.channel].spotlight = e.payload.itemId;
      break;
    default: {
      const never: never = e;
      throw new Error(`Unhandled event ${(never as { type: string }).type}`);
    }
  }
  return s;
}

export function project(sessionId: string, events: Iterable<DomainEvent>): SessionState {
  let s = emptyState(sessionId);
  for (const e of events) s = apply(s, e);
  return s;
}
