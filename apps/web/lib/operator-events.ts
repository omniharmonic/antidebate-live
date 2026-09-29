/**
 * Event types a browser (operator console, /new) may write without the ingest
 * secret. Utterances, extraction and insights come only from capture and the
 * worker, which hold ROLE_LINK_SECRET.
 *
 * AUTH GAP (R0): these writes are unauthenticated. Per-role signed links (WS3)
 * must gate them before any public deployment.
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
