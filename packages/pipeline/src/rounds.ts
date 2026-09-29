/**
 * Round detection from moderator turns (PRD §7). Formats are data
 * (packages/core/src/formats.ts); the model only picks from the listed rounds,
 * and only when the moderator's words open it unmistakably. Works the same live
 * and in replay. The operator can always set the round by hand (console).
 */
import { z } from 'zod';
import { getFormat, type DomainEvent } from '@adl/core';
import { callStructured, type LlmCallLog } from '@adl/llm';
import type { Turn } from './turns';

export const ROUNDS_PROMPT_VERSION = 'round-detect-v0.3';

export const RoundOutput = z.object({
  opensRound: z.string().nullable().describe('Round id the moderator is opening in this turn, or null'),
  certain: z.boolean().describe('true only if the moderator explicitly opens or hands over to that round'),
  quote: z.string().describe('The moderator words that open it (verbatim), or empty'),
});
export type RoundOutput = z.infer<typeof RoundOutput>;

export const ROUNDS_INSTRUCTIONS = `You follow a moderated debate and track which round it is in. You get the format's rounds in their usual order (id, name, speakers, typical moderator phrases), the current round, the moderator's previous few turns, and the moderator's latest turn.
Decide whether the latest turn (read together with the previous ones, since a moderator's announcement is often spread over several short turns) opens a new round: the moderator announces it, hands the floor for it ("Daniel, you have six minutes for your opening"), or clearly moves the debate into it (e.g. inviting the debaters to look for both/and framings, circumstances, or perverse incentives opens Exploring Integration; inviting the audience to contribute ideas opens Audience Participation).
Rounds usually proceed in the listed order; optional rounds may be skipped; formats are adapted in practice, so a round may be announced in the moderator's own words. If the moderator clearly opens a new phase or section in their own structure that matches no named round, choose that phase's "moderator's own structure" round.
- Only choose a round id from the list.
- Timekeeping, thanks, follow-up questions and summaries inside the current round open nothing: return null.
- certain=true only when the words make the transition unmistakable. Quote them exactly.
Return only the JSON object required by the schema.`;

export function buildRoundInput(formatId: string, currentRoundId: string | null, turnText: string, previousModeratorTurns: string[] = []): string {
  const f = getFormat(formatId);
  const rounds = f.rounds
    .map((r) => `- ${r.id}: ${r.name} (${f.phases.find((p) => p.id === r.phase)?.name ?? r.phase}; speakers: ${r.speakingOrder.join(', ') || 'none'}${r.optional ? '; optional' : ''}) — cues: ${r.cues.join(' / ') || 'none'}`)
    .join('\n');
  const prev = previousModeratorTurns.length ? previousModeratorTurns.map((t) => `- ${t}`).join('\n') : '(none)';
  return `FORMAT: ${f.name}\nROUNDS (usual order):\n${rounds}\n\nCURRENT ROUND: ${currentRoundId ?? 'none yet'}\n\nMODERATOR'S PREVIOUS TURNS (context):\n${prev}\n\nMODERATOR'S LATEST TURN:\n"""\n${turnText}\n"""`;
}

const PHASE_ORDER = ['clarifying_difference', 'exploring_synthesis', 'taking_stock'];

/**
 * Sequence guard (code, not model): rounds never move back to an earlier phase, and
 * move back within a phase only after the current round has run 3 minutes. This stops
 * jitter such as Steel-Manning → Open Debate → Steel-Manning within a few seconds.
 */
export function acceptRoundChange(formatId: string, currentRoundId: string | null, currentStartedMs: number | null, nextRoundId: string, atMs: number): boolean {
  const rounds = getFormat(formatId).rounds;
  const cur = currentRoundId ? rounds.find((r) => r.id === currentRoundId) : undefined;
  const next = rounds.find((r) => r.id === nextRoundId);
  if (!next) return false;
  if (!cur) return true;
  const phaseDelta = PHASE_ORDER.indexOf(next.phase) - PHASE_ORDER.indexOf(cur.phase);
  if (phaseDelta < 0) return false;
  if (phaseDelta > 0) return true;
  const backwards = rounds.indexOf(next) < rounds.indexOf(cur);
  return !backwards || currentStartedMs === null || atMs - currentStartedMs >= 180_000;
}

/** round.ended + round.started when the moderator opens a different round. */
export function roundEvents(
  turn: Turn,
  out: RoundOutput,
  ctx: { sessionId: string; formatId: string; currentRoundId: string | null; currentRoundStartedMs?: number | null; wallTs: string },
): DomainEvent[] {
  const def = out.opensRound ? getFormat(ctx.formatId).rounds.find((r) => r.id === out.opensRound) : undefined;
  if (!def || !out.certain || def.id === ctx.currentRoundId) return [];
  if (!acceptRoundChange(ctx.formatId, ctx.currentRoundId, ctx.currentRoundStartedMs ?? null, def.id, turn.startMs)) return [];
  const base = { sessionId: ctx.sessionId, actor: 'system' as const, mediaMs: turn.startMs, wallTs: ctx.wallTs, causedBy: [turn.turnId] };
  const events: DomainEvent[] = [];
  if (ctx.currentRoundId) events.push({ ...base, eventId: `${turn.turnId}:round-end`, type: 'round.ended', payload: { roundId: ctx.currentRoundId } });
  events.push({ ...base, eventId: `${turn.turnId}:round`, type: 'round.started', payload: { roundId: def.id, name: def.name, ...(def.plannedMs ? { plannedMs: def.plannedMs } : {}) } });
  return events;
}

export async function detectRound(
  turn: Turn,
  ctx: { sessionId: string; formatId: string; currentRoundId: string | null; currentRoundStartedMs?: number | null; previousModeratorTurns?: string[]; wallTs: () => string },
): Promise<{ events: DomainEvent[]; log: LlmCallLog; error?: string }> {
  const result = await callStructured({
    pass: 'round_detect',
    promptVersion: ROUNDS_PROMPT_VERSION,
    instructions: ROUNDS_INSTRUCTIONS,
    input: buildRoundInput(ctx.formatId, ctx.currentRoundId, turn.text, ctx.previousModeratorTurns),
    schema: RoundOutput,
    sessionId: ctx.sessionId,
  });
  if (!result.ok) return { events: [], log: result.log, error: `${result.reason}: ${result.detail}` };
  return { events: roundEvents(turn, result.data, { ...ctx, wallTs: ctx.wallTs() }), log: result.log };
}
