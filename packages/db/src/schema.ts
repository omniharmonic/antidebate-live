/**
 * Storage for the event log (ARCHITECTURE §4, §8). The log is the source of
 * truth. Projection tables are added as read models when a surface needs
 * server-side queries; until then projections run in memory from the log.
 */
import { bigserial, index, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  format: jsonb('format').$type<{ template: string; rounds: { id: string; name: string; plannedMs?: number }[] }>(),
  recording: jsonb('recording').$type<{ tracks: string[]; videoUrl?: string; offsetMs?: number }>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const events = pgTable(
  'events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    eventId: text('event_id').notNull(),
    sessionId: text('session_id').notNull(),
    type: text('type').notNull(),
    actor: text('actor').notNull(),
    mediaMs: integer('media_ms').notNull(),
    wallTs: timestamp('wall_ts', { withTimezone: true, mode: 'string' }).notNull(),
    causedBy: jsonb('caused_by').$type<string[]>(),
    payload: jsonb('payload').notNull(),
  },
  (t) => [
    uniqueIndex('events_event_id_uq').on(t.eventId),
    index('events_session_id_idx').on(t.sessionId, t.id),
  ],
);

export const snapshots = pgTable(
  'snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: text('session_id').notNull(),
    atEventId: integer('at_event_id').notNull(),
    atIndex: integer('at_index').notNull(),
    mediaMs: integer('media_ms').notNull(),
    state: jsonb('state').notNull(),
  },
  (t) => [index('snapshots_session_idx').on(t.sessionId, t.atIndex)],
);

export const llmCalls = pgTable('llm_calls', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: text('session_id'),
  pass: text('pass').notNull(),
  promptVersion: text('prompt_version').notNull(),
  model: text('model').notNull(),
  effort: text('effort').notNull(),
  inputTokens: integer('input_tokens').notNull(),
  cacheReadTokens: integer('cache_read_tokens').notNull(),
  cacheCreationTokens: integer('cache_creation_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  latencyMs: integer('latency_ms').notNull(),
  stopReason: text('stop_reason'),
  costUsd: real('cost_usd'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
