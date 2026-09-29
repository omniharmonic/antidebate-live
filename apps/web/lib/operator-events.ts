/**
 * Event types a browser (operator console, /new) may write, with the operator key
 * (`Authorization: Bearer <OPERATOR_KEY>`). Utterances, extraction and insights come
 * only from capture (CAPTURE_TOKEN) and the worker (ROLE_LINK_SECRET).
 */
import type { DomainEvent, EventType } from '@adl/core';

export const OPERATOR_EVENT_TYPES = new Set<EventType>([
  'session.started',
  'session.ended',
  'round.started',
  'round.ended',
  'item.approved',
  'item.rejected',
  'item.sent_to_facilitator',
  // Blackout (UX §3): immediate, only ever hides audience outputs.
  'blackout.set',
]);

/** Types the capture service may write, with `Authorization: Bearer <CAPTURE_TOKEN>`. */
export const CAPTURE_EVENT_TYPES = new Set<EventType>(['utterance.final', 'utterance.partial', 'attribution.pending', 'attribution.confirmed', 'session.started']);

export function checkEnvelope(e: unknown): string | null {
  if (!e || typeof e !== 'object') return 'event must be an object';
  const ev = e as Partial<DomainEvent>;
  if (typeof ev.eventId !== 'string' || typeof ev.sessionId !== 'string' || typeof ev.type !== 'string') return 'eventId, sessionId and type are required';
  if (!ev.eventId.startsWith(`${ev.sessionId}:`)) return 'eventId must be prefixed with the session id';
  if (typeof ev.mediaMs !== 'number' || !Number.isFinite(ev.mediaMs) || ev.mediaMs < 0) return 'mediaMs must be a non-negative number';
  if (typeof ev.wallTs !== 'string' || Number.isNaN(Date.parse(ev.wallTs))) return 'wallTs must be an ISO timestamp';
  if (!ev.payload || typeof ev.payload !== 'object') return 'payload is required';
  return null;
}

export function checkOperatorEvent(e: unknown): string | null {
  const bad = checkEnvelope(e);
  if (bad) return bad;
  const ev = e as DomainEvent;
  if (!OPERATOR_EVENT_TYPES.has(ev.type)) return `type ${ev.type} is not an operator event`;
  if (ev.actor !== 'operator') return "actor must be 'operator'";
  return null;
}

/** Client helper: a unique operator event id. */
export function operatorEventId(sessionId: string): string {
  return `${sessionId}:op:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

const KEY_STORAGE = 'adl.operatorKey';

/** The operator key: taken once from `?key=` in the URL, then kept in this browser. */
export function operatorKey(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const fromUrl = new URL(window.location.href).searchParams.get('key');
    if (fromUrl) {
      window.localStorage.setItem(KEY_STORAGE, fromUrl);
      const clean = new URL(window.location.href);
      clean.searchParams.delete('key');
      window.history.replaceState(null, '', clean.toString());
      return fromUrl;
    }
    return window.localStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
}

/** POST operator events with the key. Throws a readable error on 401. */
export async function postOperatorEvents(events: DomainEvent[]): Promise<Response> {
  const key = operatorKey();
  const res = await fetch('/api/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ events }),
  });
  if (res.status === 401) throw new Error('This action needs the operator key. Open the operator link (…?key=…) once on this device.');
  return res;
}
